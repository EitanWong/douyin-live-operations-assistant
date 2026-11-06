"""Rebuildable source index over versioned, browser-owned knowledge snapshots."""
import hashlib
import re
from urllib.parse import urlsplit


def terms(text):
    words=re.findall(r'[a-z0-9_]+|[\u3400-\u9fff]+',text.lower())
    return list(dict.fromkeys(term for word in words for term in ([word] if not re.fullmatch(r'[\u3400-\u9fff]+',word) else [*word,*[word[i:i+2] for i in range(len(word)-1)]])))


def initialize(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS knowledge_scopes(room TEXT,anchor TEXT,sequence INTEGER,PRIMARY KEY(room,anchor));
      CREATE TABLE IF NOT EXISTS knowledge_sources(room TEXT,anchor TEXT,id TEXT,source TEXT,title TEXT,text TEXT,at INTEGER,expires_at INTEGER,trust TEXT,search_terms TEXT,UNIQUE(room,anchor,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(search_terms,content='knowledge_sources',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS knowledge_insert AFTER INSERT ON knowledge_sources BEGIN INSERT INTO knowledge_fts(rowid,search_terms) VALUES(new.rowid,new.search_terms); END;
      CREATE TRIGGER IF NOT EXISTS knowledge_delete AFTER DELETE ON knowledge_sources BEGIN INSERT INTO knowledge_fts(knowledge_fts,rowid,search_terms) VALUES('delete',old.rowid,old.search_terms); END;
      CREATE TRIGGER IF NOT EXISTS knowledge_update AFTER UPDATE ON knowledge_sources BEGIN
       INSERT INTO knowledge_fts(knowledge_fts,rowid,search_terms) VALUES('delete',old.rowid,old.search_terms);
       INSERT INTO knowledge_fts(rowid,search_terms) VALUES(new.rowid,new.search_terms); END;
    ''')


def synchronize(db,record):
    data=record['payload'];rows=data.get('rows');retained=data.get('retained');seq=data.get('sequence')
    if type(seq) is not int or not 1<=seq<2**53 or type(data.get('revision')) is not int or data['revision']<0:
        raise ValueError('知识快照版本无效')
    valid_id=lambda v:isinstance(v,str) and re.fullmatch(r'[a-f0-9]{64}',v)
    if not isinstance(rows,list) or len(rows)>10 or not isinstance(retained,list) or len(retained)>1000 or len(set(retained))!=len(retained) or not all(valid_id(v) for v in retained):
        raise ValueError('知识快照无效')
    for row in rows:
        if not isinstance(row,dict) or not valid_id(row.get('id')) or row['id'] not in retained:
            raise ValueError('知识来源标识无效')
        url=urlsplit(row.get('source',''))
        if url.scheme!='https' or not url.hostname or url.username or url.password:
            raise ValueError('知识来源地址无效')
        if not isinstance(row.get('text'),str) or not 1<=len(row['text'])<=12000 or not isinstance(row.get('title'),str) or len(row['title'])>160 or row.get('trust')!='unverified':
            raise ValueError('知识原文无效')
        if any(type(row.get(k)) not in (int,float) for k in ('at','expiresAt')) or not 0<row['at']<=record['receivedAt'] or not row['at']<row['expiresAt']<=row['at']+180*86400000:
            raise ValueError('知识有效期无效')
        suffix=''
        if row.get('subject') is not None:
            subject=row['subject'];epoch=row.get('subjectEpoch')
            if not isinstance(subject,str) or not re.fullmatch(r'(?:uid:[0-9]{1,30}|sec:[A-Za-z0-9_-]{8,160})',subject) or type(epoch) is not int or not 0<=epoch<2**53:
                raise ValueError('人物知识范围无效')
            suffix=f'\n{subject}:{epoch}'
        if hashlib.sha256((row['source']+'\n'+row['text']+suffix).encode()).hexdigest()!=row['id']:
            raise ValueError('知识内容摘要不匹配')
    room,anchor=record['room'],record['anchor']
    if not anchor:raise ValueError('知识主播范围无效')
    previous=db.execute('SELECT sequence FROM knowledge_scopes WHERE room=? AND anchor=?',(room,anchor)).fetchone()
    if previous and previous['sequence']>=seq:return
    for old in db.execute('SELECT id FROM knowledge_sources WHERE room=? AND anchor=?',(room,anchor)).fetchall():
        if old['id'] not in retained:db.execute('DELETE FROM knowledge_sources WHERE room=? AND anchor=? AND id=?',(room,anchor,old['id']))
    for row in rows:
        # Personal retrieval requires the browser's current deletion watermark.
        # Retain the audit record, but never expose it through generic FTS.
        if row.get('subject'):continue
        db.execute('INSERT INTO knowledge_sources(room,anchor,id,source,title,text,at,expires_at,trust,search_terms) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room,anchor,id) DO UPDATE SET title=excluded.title,at=excluded.at,expires_at=excluded.expires_at,search_terms=excluded.search_terms',
                   (room,anchor,row['id'],row['source'],row['title'],row['text'],row['at'],row['expiresAt'],row['trust'],' '.join(terms(row['title']+' '+row['text']))))
    db.execute('INSERT INTO knowledge_scopes VALUES(?,?,?) ON CONFLICT(room,anchor) DO UPDATE SET sequence=excluded.sequence',(room,anchor,seq))


def search(db,room,anchor,query,now):
    if not re.fullmatch(r'\d{1,30}',str(room)) or not re.fullmatch(r'\d{1,30}',str(anchor)) or not isinstance(query,str) or not 1<=len(query)<=300:
        raise ValueError('知识查询范围或问题无效')
    tokens=terms(query)
    # Prefer adjacent Chinese pairs; a one-character query remains searchable.
    pairs=[t for t in tokens if len(t)>1];tokens=pairs or tokens
    expression=' OR '.join('"'+t+'"' for t in tokens[:100])
    rows=[]
    if expression:
        rows=[dict(r) for r in db.execute('SELECT s.id,s.source,s.title,s.text,s.at,s.expires_at AS expiresAt,s.trust FROM knowledge_fts JOIN knowledge_sources s ON s.rowid=knowledge_fts.rowid WHERE knowledge_fts MATCH ? AND s.room=? AND s.anchor=? AND s.at<=? AND s.expires_at>? ORDER BY bm25(knowledge_fts),s.at DESC LIMIT 8',(expression,room,anchor,now,now))]
    return {'room':room,'anchor':anchor,'method':'sqlite-fts5-zh-ngrams','rows':rows,'basis':'有效公开原文，待核实；删除同步完成后移除索引，原始审计档案独立保留'}
