import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from data_store import DataStore

NOW = 1800000000000

def record(seq, rows, retained=None):
    return {'id': f'knowledge-{seq}', 'room': '1', 'anchor': '2', 'kind': 'knowledge', 'receivedAt': NOW,
            'payload': {'revision': 0, 'sequence': seq, 'rows': rows, 'retained': retained if retained is not None else [r['id'] for r in rows]}}

def source(text, url='https://example.org/profile'):
    return {'id': hashlib.sha256((url+'\n'+text).encode()).hexdigest(), 'source': url, 'title': '公开资料', 'text': text, 'at': NOW, 'expiresAt': NOW+60000, 'trust': 'unverified'}

class KnowledgeIndexTests(unittest.TestCase):
    def test_personal_sources_archive_without_entering_general_search(self):
        with tempfile.TemporaryDirectory() as folder:
            store=DataStore(Path(folder)/'data.sqlite3')
            row={**source('茶友自述喜欢陶瓷。'),'subject':'uid:7','subjectEpoch':0}
            row['id']=hashlib.sha256((row['source']+'\n'+row['text']+'\nuid:7:0').encode()).hexdigest()
            store.append([record(1,[row])])
            self.assertEqual(store.knowledge('1','2','茶友',now=NOW)['rows'],[])
            self.assertEqual(store.status()['records'],1)
            general=source('陶瓷需用冷水清洗。')
            store.append([record(2,[general],[row['id'],general['id']])])
            self.assertEqual(len(store.knowledge('1','2','陶瓷',now=NOW)['rows']),1)
            store.close()

    def test_restart_chinese_search_scope_and_forgetting(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.sqlite3'
            row=source('阿明是小雨的师傅，喜欢陶瓷。')
            store=DataStore(path)
            store.append([record(1, [row])]);store.append([record(1, [row])]);store.close()
            store=DataStore(path)
            found=store.knowledge('1','2','阿明',now=NOW)
            self.assertEqual(len(found['rows']),1);self.assertEqual(found['rows'][0]['source'],row['source']);self.assertEqual(found['rows'][0]['trust'],'unverified')
            self.assertEqual(store.knowledge('1','3','阿明',now=NOW)['rows'],[])
            self.assertEqual(store.knowledge('1','2','明',now=NOW)['rows'][0]['id'],row['id'])
            self.assertEqual(store.knowledge('1','2','阿明',now=NOW+60001)['rows'],[])
            store.append([record(3, [])]);store.append([record(2, [row])])
            self.assertEqual(store.knowledge('1','2','阿明',now=NOW)['rows'],[]);store.close()
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('data_host.py')),'--database',str(path),'knowledge','--room','1','--anchor','2','--query','阿明'],capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout)['rows'],[])

    def test_malformed_batch_rolls_back_and_query_is_literal(self):
        with tempfile.TemporaryDirectory() as folder:
            store=DataStore(Path(folder)/'data.sqlite3');row=source('青哥是阿明的朋友')
            invalid=record(2,[{**row,'source':'file:///etc/passwd'}])
            with self.assertRaises(ValueError):store.append([record(1,[row]),invalid])
            self.assertEqual(store.status()['records'],0)
            self.assertEqual(store.knowledge('1','2','青哥',now=NOW)['rows'],[])
            store.append([record(1,[row])])
            self.assertEqual(store.knowledge('1','2','\" OR * --',now=NOW)['rows'],[])
            store.close()
