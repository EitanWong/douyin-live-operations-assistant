"""Local, append-only evidence warehouse. SQLite owns cross-process writes.

Events are observations, not a second income ledger. Prediction labels may only
join a previously issued immutable prediction after the observation is due.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time
from collections import deque

import knowledge_index
import public_media_jobs

from data_models import train_calibration, predict_calibration

KINDS = {'event', 'protocol', 'coverage', 'forecast', 'account', 'pk-state', 'knowledge'}
SECRETS = {'apikey', 'authorization', 'cookie', 'password', 'secret', 'accesstoken', 'refreshtoken'}


def default_database():
    return Path.home() / '.local/share/douyin-live-assistant/data/live.sqlite3'


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def no_credentials(value, depth=0):
    if depth > 30:
        raise ValueError('数据嵌套过深')
    if isinstance(value, dict):
        for key, child in value.items():
            if re.sub(r'[^a-z]', '', key.lower()) in SECRETS:
                raise ValueError('不能归档凭据字段')
            no_credentials(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            no_credentials(child, depth + 1)


def validate_record(row):
    if not isinstance(row, dict) or not re.fullmatch(r'\d{1,30}', str(row.get('room', ''))):
        raise ValueError('直播间无效')
    if not isinstance(row.get('id'), str) or not 1 <= len(row['id']) <= 240:
        raise ValueError('记录标识无效')
    if row.get('kind') not in KINDS or not isinstance(row.get('payload'), dict):
        raise ValueError('记录类型无效')
    if not finite(row.get('receivedAt')) or not 0 < row['receivedAt'] < 2**53:
        raise ValueError('接收时间无效')
    anchor = str(row.get('anchor') or '')
    if anchor and not re.fullmatch(r'\d{1,30}', anchor):
        raise ValueError('主播标识无效')
    no_credentials(row['payload'])
    payload = json.dumps(row['payload'], ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)
    if len(payload.encode()) > 500000:
        raise ValueError('记录过大')
    data = {k: row[k] for k in ('id', 'room', 'kind', 'receivedAt')}
    data.update(anchor=anchor, payload=row['payload'])
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    return data, payload, digest


class DataStore:
    def __init__(self, path=None):
        self.path = Path(path or default_database()).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.path, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        if self.db.execute('PRAGMA user_version').fetchone()[0] not in (0, 1):
            self.db.close()
            raise ValueError('不支持的数据库版本，原文件未迁移')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS observations (
                seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, room TEXT NOT NULL,
                anchor TEXT NOT NULL, kind TEXT NOT NULL, received_at INTEGER NOT NULL,
                event_type TEXT, user_key TEXT, payload TEXT NOT NULL, digest TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS observations_room_time ON observations(room, received_at, seq);
            CREATE INDEX IF NOT EXISTS observations_user ON observations(room, user_key, received_at);
            CREATE TABLE IF NOT EXISTS predictions (
                id TEXT PRIMARY KEY, room TEXT NOT NULL, anchor TEXT NOT NULL,
                as_of INTEGER NOT NULL, due_at INTEGER NOT NULL, frozen TEXT NOT NULL,
                actual REAL, label_at INTEGER);
            CREATE INDEX IF NOT EXISTS predictions_room_time ON predictions(room, as_of);
            CREATE TABLE IF NOT EXISTS models (
                room TEXT NOT NULL, anchor TEXT NOT NULL, target TEXT NOT NULL, horizon INTEGER NOT NULL,
                trained_at INTEGER NOT NULL, model TEXT NOT NULL, PRIMARY KEY(room,anchor,target,horizon));
            CREATE TABLE IF NOT EXISTS room_links (owner TEXT NOT NULL, room TEXT NOT NULL, at INTEGER NOT NULL,
                PRIMARY KEY(owner,room));
            CREATE TABLE IF NOT EXISTS pk_predictions (
                room TEXT NOT NULL, anchor TEXT NOT NULL, battle TEXT NOT NULL, bucket INTEGER NOT NULL,
                as_of INTEGER NOT NULL, remaining INTEGER NOT NULL, probability REAL NOT NULL,
                outcome TEXT, ended_at INTEGER, label_at INTEGER, PRIMARY KEY(room,anchor,battle,bucket));
            PRAGMA user_version=1;
        ''')
        knowledge_index.initialize(self.db)
        public_media_jobs.initialize(self.db)
        os.chmod(self.path, 0o600)

    def append(self, records):
        if not isinstance(records, list) or not 1 <= len(records) <= 64:
            raise ValueError('批次无效')
        parsed = [validate_record(row) for row in records]
        inserted = 0
        with self.db:
            for row, payload, digest in parsed:
                prior = self.db.execute('SELECT digest FROM observations WHERE id=?', (row['id'],)).fetchone()
                if prior:
                    if prior['digest'] != digest:
                        raise ValueError('同一记录标识的内容冲突')
                    continue
                event = row['payload']
                user = event.get('user') or {}
                uid = ('uid:' + str(user['id']) if user.get('id') else 'sec:' + str(user['secUid']) if user.get('secUid') else '') if isinstance(user, dict) else ''
                self.db.execute('INSERT INTO observations(id,room,anchor,kind,received_at,event_type,user_key,payload,digest) VALUES(?,?,?,?,?,?,?,?,?)',
                                (row['id'], row['room'], row['anchor'], row['kind'], row['receivedAt'],
                                 str(event.get('type') or '')[:80], uid[:180], payload, digest))
                if row['kind'] == 'knowledge':
                    knowledge_index.synchronize(self.db,row)
                if row['kind'] == 'forecast':
                    self._predictions(row)
                    self._pk_prediction(row)
                if row['kind'] == 'pk-state':
                    self._pk_outcomes(row)
                owner = event.get('ownerRoom')
                if row['kind'] == 'coverage' and isinstance(owner, str) and re.fullmatch(r'\d{1,30}', owner) and owner != row['room']:
                    self.db.execute('INSERT INTO room_links(owner,room,at) VALUES(?,?,?) ON CONFLICT(owner,room) DO UPDATE SET at=MAX(at,excluded.at)',
                                    (owner, row['room'], row['receivedAt']))
                inserted += 1
        return {'inserted': inserted, 'acknowledged': [row['id'] for row, _, _ in parsed]}

    def _prediction(self, row, forecast):
        if not isinstance(forecast, dict):
            return None
        if forecast.get('target') not in ('diamonds', 'online'):
            return None
        if not all(finite(forecast.get(k)) for k in ('asOf', 'dueAt', 'point', 'low', 'high', 'horizonMinutes')):
            return None
        if not 0 < forecast['asOf'] <= row['receivedAt'] or forecast['dueAt'] <= forecast['asOf']:
            return None
        if not 0 <= forecast['low'] <= forecast['point'] <= forecast['high']:
            return None
        if not isinstance(forecast.get('id'), str) or not 0 < len(forecast['id']) <= 240:
            return None
        keys = ('id', 'asOf', 'dueAt', 'startAt', 'point', 'low', 'high', 'target', 'horizonMinutes', 'unit', 'baseline', 'modelVersion')
        return {key: forecast[key] for key in keys if key in forecast}

    def _predictions(self, row):
        report = row['payload']
        if report.get('simulated') or report.get('scope', '').startswith('demo:'):
            return
        for forecast in report.get('forecastHistory', [])[:100]:
            frozen = self._prediction(row, forecast)
            if frozen is None or frozen['dueAt'] <= row['receivedAt']:
                continue
            key = f"{row['room']}:{row['anchor']}:{frozen['id']}"
            self.db.execute('INSERT OR IGNORE INTO predictions(id,room,anchor,as_of,due_at,frozen) VALUES(?,?,?,?,?,?)',
                            (key, row['room'], row['anchor'], frozen['asOf'], frozen['dueAt'], json.dumps(frozen, sort_keys=True)))
        for forecast in report.get('comparisons', [])[:120]:
            frozen = self._prediction(row, forecast)
            evaluation = forecast.get('evaluation') or {} if isinstance(forecast, dict) else {}
            if frozen is None or evaluation.get('status') != 'scored':
                continue
            if not finite(evaluation.get('actual')) or evaluation['actual'] < 0 or not finite(evaluation.get('at')):
                continue
            if not frozen['dueAt'] <= evaluation['at'] <= row['receivedAt']:
                continue
            key = f"{row['room']}:{row['anchor']}:{frozen['id']}"
            self.db.execute('UPDATE predictions SET actual=?,label_at=? WHERE id=? AND frozen=? AND actual IS NULL',
                            (evaluation['actual'], evaluation['at'], key, json.dumps(frozen, sort_keys=True)))

    def _pk_prediction(self, row):
        report = row['payload']
        pk = report.get('pk') or {}
        if report.get('simulated') or pk.get('status') != 'ready' or not isinstance(pk.get('battleKey'), str):
            return
        probability, remaining, at = pk.get('probability'), pk.get('remainingMs'), report.get('asOf')
        if not finite(probability) or not 0 <= probability <= 1 or not finite(remaining) or remaining <= 0 or not finite(at) or at > row['receivedAt']:
            return
        # One issued sample per battle/time bucket; splits must group by battle.
        self.db.execute('INSERT OR IGNORE INTO pk_predictions(room,anchor,battle,bucket,as_of,remaining,probability) VALUES(?,?,?,?,?,?,?)',
                        (row['room'], row['anchor'], pk['battleKey'], int(remaining // 30000), at, remaining, probability))

    def _pk_outcomes(self, row):
        for result in row['payload'].get('outcomes', [])[:200]:
            if not result.get('scoreFinal') or result.get('outcome') not in ('win', 'loss', 'draw'):
                continue
            ended = result.get('endedAt')
            if not finite(ended) or ended > row['receivedAt']:
                continue
            self.db.execute('UPDATE pk_predictions SET outcome=?,ended_at=?,label_at=? WHERE room=? AND anchor=? AND battle=? AND as_of<? AND outcome IS NULL',
                            (result['outcome'], ended, row['receivedAt'], row['room'], row['anchor'], result.get('battleKey'), ended))

    def knowledge(self, room, anchor, query, now=None):
        return knowledge_index.search(self.db,room,anchor,query,now or int(time.time()*1000))

    def status(self):
        row = self.db.execute('SELECT COUNT(*) AS records, MAX(received_at) AS latestAt FROM observations').fetchone()
        return {'backend': 'sqlite', 'schemaVersion': 1, 'database': str(self.path), **dict(row),
                'bytes': sum(p.stat().st_size for p in (self.path, Path(str(self.path) + '-wal')) if p.exists())}

    def summary(self, room, now=None, include_opponents=True):
        if not re.fullmatch(r'\d{1,30}', str(room)):
            raise ValueError('直播间无效')
        now = now or int(time.time() * 1000)
        rows = self.db.execute('SELECT event_type, COUNT(*) AS n FROM observations WHERE room=? AND kind=? AND received_at BETWEEN ? AND ? GROUP BY event_type',
                               (room, 'event', now - 900000, now)).fetchall()
        users = self.db.execute("SELECT COUNT(DISTINCT user_key) FROM observations WHERE room=? AND user_key!='' AND received_at BETWEEN ? AND ?",
                                (room, now - 900000, now)).fetchone()[0]
        coverage = self.db.execute("SELECT payload,received_at FROM observations WHERE room=? AND kind='coverage' AND received_at<=? ORDER BY received_at DESC,seq DESC LIMIT 1", (room, now)).fetchone()
        coverage_value = {**json.loads(coverage['payload']), 'receivedAt': coverage['received_at'], 'fresh': now - coverage['received_at'] < 15000} if coverage else None
        if coverage_value:
            coverage_value['connected'] = coverage_value.get('connected') is True and coverage_value['fresh']
        return {'room': room, 'asOf': now, 'windowMinutes': 15, 'eventCounts': {r['event_type']: r['n'] for r in rows},
                'observedUsers': users, 'coverage': coverage_value,
                'opponents': [self.summary(r['room'], now, False) for r in self.db.execute('SELECT room FROM room_links WHERE owner=? AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 3',
                                                                                      (room, now - 900000, now))] if include_opponents else [],
                'basis': '仅本机已观察样本；不是全部在线名单，不从礼物事件重复核算收入'}

    def train(self, room, anchor, target, horizon, now=None):
        if target not in ('diamonds', 'online') or type(horizon) is not int or not 1 <= horizon <= 720:
            raise ValueError('训练目标无效')
        now = now or int(time.time() * 1000)
        rows = deque((r for r in self.dataset(room) if r['anchor'] == anchor and r['target'] == target and r['horizonMinutes'] == horizon and r['labelAt'] < now), maxlen=10000)
        model = train_calibration(list(rows))
        with self.db:
            # An unsuccessful retrain deactivates the old model after drift.
            self.db.execute('INSERT INTO models VALUES(?,?,?,?,?,?) ON CONFLICT(room,anchor,target,horizon) DO UPDATE SET trained_at=excluded.trained_at,model=excluded.model',
                            (room, anchor, target, horizon, now, json.dumps(model)))
        return model

    def audience(self, room, keys):
        if not isinstance(keys, list) or len(keys) > 20 or any(not isinstance(k, str) or not re.fullmatch(r'(?:uid:\d{1,30}|sec:[\w-]{1,160})', k) for k in keys):
            raise ValueError('观众查询需要已观察的稳定标识，每批最多20人')
        topics = {'音乐': ('吉他', '唱歌', '音乐', '钢琴', '跳舞'), '游戏': ('游戏', '王者', '原神'),
                  '美食': ('美食', '做菜', '烹饪'), '运动': ('足球', '篮球', '健身'), '数码': ('数码', '电脑', '摄影')}
        result = []
        for key in keys:
            counts = {r['event_type']: r['n'] for r in self.db.execute('SELECT event_type,COUNT(*) n FROM observations WHERE room=? AND user_key=? GROUP BY event_type', (room, key))}
            interests = []
            for row in self.db.execute("SELECT id,received_at,payload FROM observations WHERE room=? AND user_key=? AND event_type='chat' ORDER BY received_at DESC LIMIT 100", (room, key)):
                text = json.loads(row['payload']).get('text') or ''
                expression = re.search(r'(?:^|[，。！!\s])(?:我|本人)?(?:很|特别|最)?(?:喜欢|想看|想听|想学|爱看)([^，。！？!?]{1,30})', text)
                if not expression:
                    continue
                for topic, words in topics.items():
                    if any(word in expression[1] for word in words) and not any(r['topic'] == topic for r in interests):
                        interests.append({'topic': topic, 'evidence': text[:120], 'at': row['received_at'], 'eventId': row['id']})
                if len(interests) >= 4:
                    break
            result.append({'userKey': key, 'chatMessages': counts.get('chat', 0), 'giftMessages': counts.get('gift', 0),
                           'declaredInterests': interests[:4], 'basis': '仅已采集互动及明确兴趣表达；礼物消息包含连击更新，不代表送礼次数、金额、财力或心理'})
        return result

    def predict(self, room, anchor, as_of, rows):
        if not finite(as_of) or not isinstance(rows, list) or len(rows) > 4:
            raise ValueError('本地推理请求无效')
        result = []
        for row in rows:
            model_row = self.db.execute('SELECT * FROM models WHERE room=? AND anchor=? AND target=? AND horizon=? AND trained_at<?',
                                        (room, anchor, row.get('target'), row.get('horizonMinutes'), as_of)).fetchone()
            if model_row is None:
                continue
            model = json.loads(model_row['model'])
            if model.get('status') != 'validated' or model['trainingUntil'] >= as_of:
                continue
            result.append({'target': row['target'], 'horizonMinutes': row['horizonMinutes'],
                           'status': 'ready', 'unit': 'diamonds' if row['target'] == 'diamonds' else 'people',
                           'trainedAt': model_row['trained_at'], **predict_calibration(model, row)})
        return {'asOf': as_of, 'scope': f'{room}:{anchor}', 'rows': result,
                'basis': '本地独立推理候选，与原始预测分别保存；仅对具有留出集验证的目标返回数值'}

    def export(self, room=None):
        query, args = ('SELECT * FROM observations ORDER BY seq', ()) if room is None else ('SELECT * FROM observations WHERE room=? ORDER BY seq', (room,))
        cursor = self.db.execute(query, args)
        for row in cursor:
            yield {'schemaVersion': 1, 'id': row['id'], 'room': row['room'], 'anchor': row['anchor'],
                   'kind': row['kind'], 'receivedAt': row['received_at'], 'payload': json.loads(row['payload'])}

    def dataset(self, room=None):
        clause, args = ('', ()) if room is None else (' AND room=?', (room,))
        for row in self.db.execute('SELECT * FROM predictions WHERE actual IS NOT NULL' + clause + ' ORDER BY as_of,id', args):
            f = json.loads(row['frozen'])
            yield {'schemaVersion': 1, 'id': row['id'], 'room': row['room'], 'anchor': row['anchor'],
                   'asOf': row['as_of'], 'dueAt': row['due_at'], 'labelAt': row['label_at'],
                   'target': f['target'], 'unit': f.get('unit'), 'horizonMinutes': f['horizonMinutes'],
                   'features': {k: f[k] for k in ('point', 'low', 'high', 'baseline') if k in f}, 'actual': row['actual']}

    def pk_dataset(self, room=None):
        clause, args = ('', ()) if room is None else (' AND room=?', (room,))
        for row in self.db.execute('SELECT * FROM pk_predictions WHERE outcome IS NOT NULL' + clause + ' ORDER BY as_of,battle,bucket', args):
            yield {'schemaVersion': 1, 'room': row['room'], 'anchor': row['anchor'], 'battleKey': row['battle'],
                   'asOf': row['as_of'], 'endedAt': row['ended_at'], 'labelAt': row['label_at'], 'remainingBucket': row['bucket'],
                   'features': {'probability': row['probability'], 'remainingMs': row['remaining']}, 'outcome': row['outcome']}

    def backup(self, output):
        target = Path(output).expanduser().resolve()
        if target.exists():
            raise ValueError('备份目标已存在，请使用新的文件名')
        dest = sqlite3.connect(target)
        try:
            self.db.backup(dest)
        finally:
            dest.close()
        os.chmod(target, 0o600)

    def close(self):
        self.db.close()
