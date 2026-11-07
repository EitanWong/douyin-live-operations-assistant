"""SQLite jobs and evidence over the existing archive connection.

Every worker write is fenced by an expiring lease and a subject deletion epoch.
Media files are disposable; only source identity, checkpoints and evidence persist.
"""
from contextlib import contextmanager
import hashlib
import json
import re
import sqlite3
import time
import uuid
from public_media_source import MAX_DURATION_MS, validate_media_source
from public_media_frames import frame_positions


LEASE_MS = 60000
SUBJECT = r'(?:uid:[0-9]{1,30}|sec:[A-Za-z0-9_-]{8,160})'


def initialize(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS public_media_epochs(room TEXT,anchor TEXT,subject TEXT,epoch INTEGER NOT NULL,PRIMARY KEY(room,anchor,subject));
      CREATE TABLE IF NOT EXISTS public_media_jobs(
       id TEXT PRIMARY KEY,room TEXT,anchor TEXT,subject TEXT,epoch INTEGER,work_id TEXT,author TEXT,url TEXT,
       analysis_version TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,cursor_ms INTEGER DEFAULT 0,
       lease TEXT,lease_until INTEGER,worker TEXT,not_before INTEGER DEFAULT 0,recoveries INTEGER DEFAULT 0,
       failures INTEGER DEFAULT 0,error TEXT,coverage TEXT);
      CREATE INDEX IF NOT EXISTS public_media_pending ON public_media_jobs(status,not_before,created_at);
      CREATE TABLE IF NOT EXISTS public_media_segments(
       job_id TEXT,kind TEXT,start_ms INTEGER,end_ms INTEGER,text TEXT,speaker TEXT,
       PRIMARY KEY(job_id,kind,start_ms,end_ms),FOREIGN KEY(job_id) REFERENCES public_media_jobs(id));
      CREATE TABLE IF NOT EXISTS public_media_blobs(job_id TEXT PRIMARY KEY,sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS public_media_controls(room TEXT,anchor TEXT,subject TEXT,allowed INTEGER NOT NULL,PRIMARY KEY(room,anchor,subject));
      CREATE TABLE IF NOT EXISTS public_media_imports(job_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS public_media_sources(job_id TEXT PRIMARY KEY,payload TEXT NOT NULL,observed_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS public_media_visual(job_id TEXT PRIMARY KEY,duration_ms INTEGER NOT NULL,positions TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,models TEXT NOT NULL DEFAULT '{}');
    ''')
    if 'models' not in {row[1] for row in db.execute('PRAGMA table_info(public_media_visual)')}:
        db.execute("ALTER TABLE public_media_visual ADD COLUMN models TEXT NOT NULL DEFAULT '{}'")


def scope(room, anchor, subject=None):
    if not all(isinstance(v, str) and re.fullmatch(r'[0-9]{1,30}', v) for v in (room, anchor)) or subject is not None and (not isinstance(subject, str) or not re.fullmatch(SUBJECT, subject)):
        raise ValueError('MEDIA_SCOPE')


def request_data(request):
    keys = {'room', 'anchor', 'subject', 'epoch', 'workId', 'author', 'url'}
    if not isinstance(request, dict) or not keys <= set(request) <= keys | {'knowledgeVersion', 'pageMedia', 'visualVersion'}:
        raise ValueError('MEDIA_INPUT')
    if not isinstance(request['subject'], str):
        raise ValueError('MEDIA_SCOPE')
    scope(request['room'], request['anchor'], request['subject'])
    if (type(request['epoch']) is not int or not 0 <= request['epoch'] < 2**53
            or not isinstance(request['workId'], str) or not re.fullmatch(r'[0-9]{1,30}', request['workId'])
            or not isinstance(request['author'], str) or not re.fullmatch(r'[A-Za-z0-9_.=-]{1,160}', request['author'])
            or request['url'] != 'https://www.douyin.com/video/' + request['workId']):
        raise ValueError('MEDIA_INPUT')
    version = request.get('knowledgeVersion', 0)
    if type(version) is not int or not 0 <= version < 2**53:
        raise ValueError('MEDIA_INPUT')
    if 'visualVersion' in request and (type(request['visualVersion']) is not int or request['visualVersion'] != 1):
        raise ValueError('MEDIA_INPUT')
    return {**request, 'knowledgeVersion': version}


def segment_data(value):
    if (not isinstance(value, dict) or set(value) != {'kind', 'startMs', 'endMs', 'text', 'speaker'}
            or value['kind'] not in ('transcript', 'visual', 'ocr', 'caption') or value['speaker'] != 'unknown'
            or not isinstance(value['text'], str) or len(value['text']) > 1200 or '\x00' in value['text']
            or any(type(value[k]) is not int for k in ('startMs', 'endMs'))
            or not 0 <= value['startMs'] < value['endMs'] <= MAX_DURATION_MS):
        raise ValueError('MEDIA_SEGMENT')
    return dict(value)


class PublicMediaJobs:
    def __init__(self, db, now=None):
        self.db, self.now = db, now or (lambda: int(time.time()*1000))
        self.db.row_factory = sqlite3.Row
        initialize(db)

    @contextmanager
    def transaction(self):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            yield

    def current_epoch(self, room, anchor, subject):
        row = self.db.execute('SELECT epoch FROM public_media_epochs WHERE room=? AND anchor=? AND subject=?', (room, anchor, subject)).fetchone()
        return row['epoch'] if row else None

    def submit(self, request):
        data = request_data(request)
        identity = [data[k] for k in ('room', 'anchor', 'subject', 'epoch', 'workId', 'author')]+['sensevoice-v1', data['knowledgeVersion']]
        analysis = 'sensevoice-v1'
        if data.get('visualVersion') == 1:
            identity.append('keyframes-v1')
            analysis += '+keyframes-v1'
        job_id = hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()
        with self.transaction():
            page_media = validate_media_source(data['pageMedia'], data, self.now()) if 'pageMedia' in data else None
            current = self.current_epoch(data['room'], data['anchor'], data['subject'])
            if current is not None and data['epoch'] != current:
                raise ValueError('MEDIA_EPOCH')
            permission = self.db.execute('SELECT allowed FROM public_media_controls WHERE room=? AND anchor=? AND subject=?', (data['room'], data['anchor'], data['subject'])).fetchone()
            if permission and not permission['allowed']:
                raise ValueError('MEDIA_DISABLED')
            self.db.execute('INSERT OR IGNORE INTO public_media_epochs VALUES(?,?,?,?)', (data['room'], data['anchor'], data['subject'], data['epoch']))
            existing = self.db.execute('SELECT status FROM public_media_jobs WHERE id=?', (job_id,)).fetchone()
            reopen = existing and (existing['status'] == 'cancelled' or existing['status'] == 'failed' and page_media)
            if (not existing or reopen) and self.db.execute("SELECT COUNT(*) FROM public_media_jobs WHERE status IN ('queued','running','paused')").fetchone()[0] >= 32:
                raise ValueError('MEDIA_QUEUE_FULL')
            if not existing:
                at = self.now()
                self.db.execute('INSERT INTO public_media_jobs(id,room,anchor,subject,epoch,work_id,author,url,analysis_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                                (job_id, data['room'], data['anchor'], data['subject'], data['epoch'], data['workId'], data['author'], data['url'], analysis, 'queued', at, at))
                self.db.execute('INSERT INTO public_media_imports(job_id,revision) VALUES(?,?)', (job_id, data['knowledgeVersion']))
            elif reopen:
                self.db.execute("UPDATE public_media_jobs SET status='queued',error=NULL,not_before=0,failures=0,recoveries=0 WHERE id=?", (job_id,))
            if page_media and (not existing or existing['status'] != 'succeeded'):
                self.db.execute('INSERT INTO public_media_sources VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=observed_at',
                                (job_id, json.dumps(page_media), page_media['observedAt'], page_media['expiresAt']))
        return self.get(job_id)

    def get(self, job_id):
        row = self.db.execute('SELECT * FROM public_media_jobs WHERE id=?', (job_id,)).fetchone()
        if row is None:
            raise ValueError('MEDIA_JOB')
        blob = self.db.execute('SELECT sha256 FROM public_media_blobs WHERE job_id=?', (job_id,)).fetchone()
        receipt = self.db.execute('SELECT * FROM public_media_imports WHERE job_id=?', (job_id,)).fetchone()
        visual = self.visual_state(job_id)
        return {'id': row['id'], 'room': row['room'], 'anchor': row['anchor'], 'subject': row['subject'], 'epoch': row['epoch'],
                'workId': row['work_id'], 'author': row['author'], 'url': row['url'], 'analysisVersion': row['analysis_version'],
                'status': row['status'], 'cursorMs': row['cursor_ms'], 'lease': row['lease'], 'leaseUntil': row['lease_until'],
                'mediaHash': blob['sha256'] if blob else None,
                'visual': {'version':visual['version'],'durationMs':visual['durationMs'],'planned':len(visual['positionsMs']),'completed':visual['completed']} if visual else None,
                'createdAt': row['created_at'], 'updatedAt': row['updated_at'],
                'knowledgeVersion': receipt['revision'] if receipt else 0,
                'importCursor': receipt['cursor'] if receipt else 0, 'imported': bool(receipt['complete']) if receipt else False,
                'error': row['error'], 'coverage': json.loads(row['coverage']) if row['coverage'] else {'audio': 'pending', 'video': 'not-analyzed'}}

    def source(self, job_id, lease):
        with self.transaction():
            job = dict(self.fenced(job_id, lease))
            self.db.execute('DELETE FROM public_media_sources WHERE expires_at<=?', (self.now(),))
            row = self.db.execute('SELECT payload FROM public_media_sources WHERE job_id=?', (job_id,)).fetchone()
            if row is None:
                return None
            return validate_media_source(json.loads(row['payload']), {'workId':job['work_id'],'author':job['author'],'subject':job['subject'],'epoch':job['epoch']}, self.now())

    def list(self, room, anchor):
        scope(room, anchor)
        return [self.get(row['id']) for row in self.db.execute("SELECT j.id FROM public_media_jobs j LEFT JOIN public_media_imports i ON j.id=i.job_id WHERE room=? AND anchor=? ORDER BY CASE WHEN status IN ('queued','running','paused') THEN 0 WHEN status='succeeded' AND COALESCE(i.complete,0)=0 THEN 1 ELSE 2 END,created_at DESC,j.id LIMIT 32", (room, anchor))]

    def scopes(self, after=None):
        if after is not None:
            if not isinstance(after, list) or len(after) != 2:
                raise ValueError('MEDIA_SCOPE')
            scope(*after)
        return [dict(row) for row in self.db.execute('SELECT room,anchor FROM public_media_epochs WHERE (room,anchor)>(?,?) GROUP BY room,anchor ORDER BY room,anchor LIMIT 64', tuple(after or ['', '']))]

    def sync_subject(self, room, anchor, subject, epoch, allowed):
        if not isinstance(subject, str):
            raise ValueError('MEDIA_SCOPE')
        scope(room, anchor, subject)
        if type(epoch) is not int or not 0 <= epoch < 2**53 or type(allowed) is not bool:
            raise ValueError('MEDIA_EPOCH')
        with self.transaction():
            return self._sync_subject(room, anchor, subject, epoch, allowed)

    def _sync_subject(self, room, anchor, subject, epoch, allowed):
        current = self.current_epoch(room, anchor, subject)
        if current is not None and epoch < current:
            if allowed:
                raise ValueError('MEDIA_EPOCH')
            epoch = current
        args = (room, anchor, subject)
        if current is not None and epoch > current:
            self._erase_subject(args)
        if not allowed:
            self.db.execute('DELETE FROM public_media_sources WHERE job_id IN (SELECT id FROM public_media_jobs WHERE room=? AND anchor=? AND subject=?)', args)
            self.db.execute("UPDATE public_media_jobs SET status='cancelled',lease=NULL,worker=NULL WHERE room=? AND anchor=? AND subject=?", args)
        self.db.execute('INSERT INTO public_media_epochs VALUES(?,?,?,?) ON CONFLICT(room,anchor,subject) DO UPDATE SET epoch=excluded.epoch', (*args, epoch))
        self.db.execute('INSERT INTO public_media_controls VALUES(?,?,?,?) ON CONFLICT(room,anchor,subject) DO UPDATE SET allowed=excluded.allowed', (*args, int(allowed)))
        return epoch

    def _erase_subject(self, args):
        self.db.execute('DELETE FROM public_media_visual WHERE job_id IN (SELECT id FROM public_media_jobs WHERE room=? AND anchor=? AND subject=?)', args)
        self.db.execute('DELETE FROM public_media_sources WHERE job_id IN (SELECT id FROM public_media_jobs WHERE room=? AND anchor=? AND subject=?)', args)
        self.db.execute('DELETE FROM public_media_segments WHERE job_id IN (SELECT id FROM public_media_jobs WHERE room=? AND anchor=? AND subject=?)', args)
        self.db.execute('DELETE FROM public_media_blobs WHERE job_id IN (SELECT id FROM public_media_jobs WHERE room=? AND anchor=? AND subject=?)', args)
        self.db.execute("UPDATE public_media_jobs SET status='cancelled',lease=NULL,worker=NULL,coverage=NULL,cursor_ms=0,updated_at=? WHERE room=? AND anchor=? AND subject=?", (self.now(), *args))

    def reconcile(self, room, anchor, privacy, allowed):
        scope(room, anchor)
        if (type(allowed) is not bool or not isinstance(privacy, dict) or set(privacy) != {'present', 'forgetBefore', 'forgotten'}
                or type(privacy['present']) is not bool or type(privacy['forgetBefore']) is not int or not 0 <= privacy['forgetBefore'] < 2**53
                or not isinstance(privacy['forgotten'], list) or len(privacy['forgotten']) > 5000):
            raise ValueError('MEDIA_PRIVACY')
        epochs = {}
        for row in privacy['forgotten']:
            if not isinstance(row, dict) or set(row) != {'key', 'at'} or not isinstance(row['key'], str) or type(row['at']) is not int or not 0 <= row['at'] < 2**53:
                raise ValueError('MEDIA_PRIVACY')
            scope(room, anchor, row['key'])
            epochs[row['key']] = max(epochs.get(row['key'], 0), row['at'])
        with self.transaction():
            subjects = self.db.execute('SELECT subject,epoch FROM public_media_epochs WHERE room=? AND anchor=?', (room, anchor)).fetchall()
            for row in subjects:
                epoch = max(row['epoch'], privacy['forgetBefore'], epochs.get(row['subject'], 0))
                self._sync_subject(room, anchor, row['subject'], epoch, allowed and privacy['present'])
                if not privacy['present']:
                    self._erase_subject((room, anchor, row['subject']))
        return {'subjects': len(subjects)}

    def acknowledge_import(self, job_id, cursor, complete):
        if type(cursor) is not int or cursor < 0 or type(complete) is not bool:
            raise ValueError('MEDIA_IMPORT')
        with self.transaction():
            job = self.get(job_id)
            total = self.db.execute('SELECT COUNT(*) FROM public_media_segments WHERE job_id=?', (job_id,)).fetchone()[0]
            if (job['status'] != 'succeeded' or job['epoch'] != self.current_epoch(job['room'], job['anchor'], job['subject'])
                    or not job['importCursor'] <= cursor <= min(total, job['importCursor']+8) or complete and cursor != total):
                raise ValueError('MEDIA_IMPORT')
            self.db.execute('INSERT INTO public_media_imports VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET cursor=excluded.cursor,complete=MAX(complete,excluded.complete)', (job_id, job['knowledgeVersion'], cursor, int(complete)))
        return self.get(job_id)

    def claim(self, worker):
        if not isinstance(worker, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', worker):
            raise ValueError('MEDIA_WORKER')
        with self.transaction():
            at = self.now()
            self.db.execute("UPDATE public_media_jobs SET status=CASE WHEN recoveries>=3 THEN 'failed' ELSE 'queued' END,recoveries=recoveries+1,lease=NULL,worker=NULL,error='MEDIA_INTERRUPTED',updated_at=? WHERE status='running' AND lease_until<=?", (at, at))
            if self.db.execute("SELECT 1 FROM public_media_jobs WHERE status='running' LIMIT 1").fetchone():
                return None
            row = self.db.execute("SELECT id FROM public_media_jobs WHERE status IN ('queued','paused') AND not_before<=? ORDER BY created_at,id LIMIT 1", (at,)).fetchone()
            if row is None:
                return None
            self.db.execute("UPDATE public_media_jobs SET status='running',lease=?,lease_until=?,worker=?,updated_at=?,error=NULL WHERE id=?", (uuid.uuid4().hex, at+LEASE_MS, worker, at, row['id']))
            return self.get(row['id'])

    def fenced(self, job_id, lease):
        row = self.db.execute('SELECT * FROM public_media_jobs WHERE id=?', (job_id,)).fetchone()
        if row is None or row['status'] != 'running' or not isinstance(lease, str) or row['lease'] != lease or row['lease_until'] <= self.now():
            raise ValueError('MEDIA_LEASE')
        if self.current_epoch(row['room'], row['anchor'], row['subject']) != row['epoch']:
            raise ValueError('MEDIA_EPOCH')
        return row

    def renew(self, job_id, lease):
        with self.transaction():
            self.fenced(job_id, lease)
            self.db.execute('UPDATE public_media_jobs SET lease_until=?,updated_at=? WHERE id=?', (self.now()+LEASE_MS, self.now(), job_id))

    def bind_media(self, job_id, lease, sha256):
        if not isinstance(sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', sha256):
            raise ValueError('MEDIA_HASH')
        with self.transaction():
            self.fenced(job_id, lease)
            old = self.db.execute('SELECT sha256 FROM public_media_blobs WHERE job_id=?', (job_id,)).fetchone()
            if not old or old['sha256'] != sha256:
                self.db.execute('DELETE FROM public_media_visual WHERE job_id=?', (job_id,))
                self.db.execute('DELETE FROM public_media_segments WHERE job_id=?', (job_id,))
                self.db.execute('UPDATE public_media_imports SET cursor=0,complete=0 WHERE job_id=?', (job_id,))
                self.db.execute('UPDATE public_media_jobs SET cursor_ms=0,coverage=NULL WHERE id=?', (job_id,))
                self.db.execute('INSERT INTO public_media_blobs VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET sha256=excluded.sha256', (job_id, sha256))
        return self.get(job_id)

    def covered(self, job_id, end_ms):
        cursor = 0
        for row in self.db.execute("SELECT start_ms,end_ms FROM public_media_segments WHERE job_id=? AND kind='transcript' ORDER BY start_ms,end_ms", (job_id,)):
            if row['start_ms'] > cursor:
                return False
            cursor = max(cursor, row['end_ms'])
        return cursor >= end_ms

    def checkpoint(self, job_id, lease, segments, cursor_ms):
        if not isinstance(segments, list) or not 1 <= len(segments) <= 16 or type(cursor_ms) is not int or not 0 <= cursor_ms <= MAX_DURATION_MS:
            raise ValueError('MEDIA_SEGMENT')
        parsed = [segment_data(row) for row in segments]
        with self.transaction():
            job = self.fenced(job_id, lease)
            if not self.db.execute('SELECT 1 FROM public_media_blobs WHERE job_id=?', (job_id,)).fetchone():
                raise ValueError('MEDIA_UNBOUND')
            if cursor_ms < job['cursor_ms']:
                raise ValueError('MEDIA_SEGMENT_CURSOR')
            for row in parsed:
                values = (job_id, row['kind'], row['startMs'], row['endMs'])
                old = self.db.execute('SELECT text FROM public_media_segments WHERE job_id=? AND kind=? AND start_ms=? AND end_ms=?', values).fetchone()
                if old and old['text'] != row['text']:
                    raise ValueError('MEDIA_SEGMENT_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO public_media_segments VALUES(?,?,?,?,?,?)', (*values, row['text'], row['speaker']))
            if not self.covered(job_id, cursor_ms):
                raise ValueError('MEDIA_SEGMENT_GAP')
            self.db.execute('UPDATE public_media_jobs SET cursor_ms=?,lease_until=?,updated_at=? WHERE id=?', (cursor_ms, self.now()+LEASE_MS, self.now(), job_id))

    def visual_state(self, job_id):
        row = self.db.execute('SELECT * FROM public_media_visual WHERE job_id=?', (job_id,)).fetchone()
        return {'version':'uniform-keyframes-v1','durationMs':row['duration_ms'],'positionsMs':json.loads(row['positions']),'completed':row['cursor']} if row else None

    def configure_visual(self, job_id, lease, duration_ms):
        positions = frame_positions(duration_ms)
        with self.transaction():
            job = self.fenced(job_id, lease)
            if not job['analysis_version'].endswith('+keyframes-v1') or job['cursor_ms'] != duration_ms or not self.covered(job_id, duration_ms):
                raise ValueError('MEDIA_COVERAGE')
            old = self.db.execute('SELECT duration_ms,positions FROM public_media_visual WHERE job_id=?', (job_id,)).fetchone()
            if old and (old['duration_ms'] != duration_ms or json.loads(old['positions']) != positions):
                raise ValueError('MEDIA_COVERAGE')
            self.db.execute('INSERT OR IGNORE INTO public_media_visual(job_id,duration_ms,positions) VALUES(?,?,?)', (job_id, duration_ms, json.dumps(positions)))
        return self.visual_state(job_id)

    def checkpoint_visual(self, job_id, lease, position_ms, at_ms, text, model):
        with self.transaction():
            self.fenced(job_id, lease)
            state = self.db.execute('SELECT * FROM public_media_visual WHERE job_id=?', (job_id,)).fetchone()
            if state is None or type(position_ms) is not int or type(at_ms) is not int or not isinstance(model, str) or not 1 <= len(model) <= 200 or '\x00' in model:
                raise ValueError('MEDIA_VISUAL_FAILED')
            positions = json.loads(state['positions'])
            if position_ms not in positions:
                raise ValueError('MEDIA_VISUAL_FAILED')
            index = positions.index(position_ms)
            if index > state['cursor'] or not position_ms <= at_ms < (positions[index+1] if index+1 < len(positions) else state['duration_ms']):
                raise ValueError('MEDIA_VISUAL_FAILED')
            row = segment_data({'kind':'visual','startMs':at_ms,'endMs':at_ms+1,'text':text,'speaker':'unknown'})
            old = self.db.execute("SELECT text FROM public_media_segments WHERE job_id=? AND kind='visual' AND start_ms=? AND end_ms=?", (job_id, at_ms, at_ms+1)).fetchone()
            models = json.loads(state['models'])
            if old and old['text'] != row['text'] or index < state['cursor'] and (old is None or models.get(str(at_ms)) != model):
                raise ValueError('MEDIA_SEGMENT_CONFLICT')
            self.db.execute('INSERT OR IGNORE INTO public_media_segments VALUES(?,?,?,?,?,?)', (job_id,'visual',at_ms,at_ms+1,row['text'],'unknown'))
            models[str(at_ms)] = model
            self.db.execute('UPDATE public_media_visual SET cursor=MAX(cursor,?),models=? WHERE job_id=?', (index+1,json.dumps(models),job_id))
        return self.get(job_id)['visual']

    def complete(self, job_id, lease, duration_ms):
        if type(duration_ms) is not int or not 0 < duration_ms <= MAX_DURATION_MS:
            raise ValueError('MEDIA_COVERAGE')
        with self.transaction():
            job = self.fenced(job_id, lease)
            if job['cursor_ms'] != duration_ms or not self.covered(job_id, duration_ms):
                raise ValueError('MEDIA_COVERAGE')
            visual = self.db.execute("SELECT 1 FROM public_media_segments WHERE job_id=? AND kind IN ('visual','ocr') LIMIT 1", (job_id,)).fetchone()
            coverage = {'audio': 'complete', 'durationMs': duration_ms, 'video': 'sampled' if visual else 'not-analyzed', 'speaker': 'unknown'}
            if job['analysis_version'].endswith('+keyframes-v1'):
                state = self.get(job_id)['visual']
                if not state or state['durationMs'] != duration_ms or state['completed'] != state['planned']:
                    raise ValueError('MEDIA_COVERAGE')
                coverage['visual'] = state
            self.db.execute("UPDATE public_media_jobs SET status='succeeded',lease=NULL,worker=NULL,updated_at=?,coverage=? WHERE id=?", (self.now(), json.dumps(coverage), job_id))
            self.db.execute('DELETE FROM public_media_sources WHERE job_id=?', (job_id,))
        return self.get(job_id)

    def pause(self, job_id, lease, reason, delay_ms=1000):
        if reason not in ('live-asr', 'model-unprepared') or type(delay_ms) is not int or not 1000 <= delay_ms <= 3600000:
            raise ValueError('MEDIA_PAUSE')
        with self.transaction():
            self.fenced(job_id, lease)
            self.db.execute("UPDATE public_media_jobs SET status='paused',lease=NULL,worker=NULL,error=?,not_before=?,updated_at=? WHERE id=?", (reason, self.now()+delay_ms, self.now(), job_id))

    def fail(self, job_id, lease, code):
        if code not in ('MEDIA_DOWNLOAD_FAILED', 'MEDIA_AUTHOR_MISMATCH', 'MEDIA_DECODE_FAILED', 'MEDIA_ANALYSIS_FAILED', 'MEDIA_VISUAL_FAILED'):
            raise ValueError('MEDIA_ERROR')
        with self.transaction():
            row = self.fenced(job_id, lease)
            retry = code != 'MEDIA_AUTHOR_MISMATCH' and row['failures'] < 2
            if not retry:
                self.db.execute('DELETE FROM public_media_sources WHERE job_id=?', (job_id,))
            self.db.execute('UPDATE public_media_jobs SET status=?,lease=NULL,worker=NULL,error=?,failures=failures+1,not_before=?,updated_at=? WHERE id=?',
                            ('paused' if retry else 'failed', code, self.now()+60000*(row['failures']+1), self.now(), job_id))

    def cancel(self, job_id, room, anchor):
        scope(room, anchor)
        with self.transaction():
            job = self.get(job_id)
            if job['room'] != room or job['anchor'] != anchor:
                raise ValueError('MEDIA_SCOPE')
            self.db.execute("UPDATE public_media_jobs SET status='cancelled',lease=NULL,worker=NULL,updated_at=? WHERE id=?", (self.now(), job_id))
            self.db.execute('DELETE FROM public_media_sources WHERE job_id=?', (job_id,))
        return self.get(job_id)

    def forget(self, room, anchor, subject, epoch):
        if not isinstance(subject, str):
            raise ValueError('MEDIA_SCOPE')
        scope(room, anchor, subject)
        if type(epoch) is not int or not 0 <= epoch < 2**53-1:
            raise ValueError('MEDIA_EPOCH')
        with self.transaction():
            current = self.current_epoch(room, anchor, subject)
            next_epoch = max(epoch+1, current or 0)
            self.db.execute('INSERT INTO public_media_epochs VALUES(?,?,?,?) ON CONFLICT(room,anchor,subject) DO UPDATE SET epoch=excluded.epoch', (room, anchor, subject, next_epoch))
            args = (room, anchor, subject)
            self._erase_subject(args)
        return next_epoch

    def evidence(self, job_id, offset=0, limit=8):
        self.get(job_id)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 8:
            raise ValueError('MEDIA_SEGMENT_PAGE')
        visual = self.db.execute('SELECT models FROM public_media_visual WHERE job_id=?', (job_id,)).fetchone()
        models = json.loads(visual['models']) if visual else {}
        return [{'kind': r['kind'], 'startMs': r['start_ms'], 'endMs': r['end_ms'], 'text': r['text'], 'speaker': r['speaker'],
                 **({'model':models[str(r['start_ms'])]} if r['kind']=='visual' and str(r['start_ms']) in models else {})}
                for r in self.db.execute('SELECT * FROM public_media_segments WHERE job_id=? ORDER BY start_ms,end_ms,kind LIMIT ? OFFSET ?', (job_id, limit, offset))]
