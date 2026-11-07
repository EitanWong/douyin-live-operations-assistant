import tempfile
import io
import unittest
from pathlib import Path

from data_host import handle
from data_store import DataStore
from public_media_jobs import PublicMediaJobs
from protocol import write_message


class PublicMediaAPIContracts(unittest.TestCase):
    def test_maximum_unicode_evidence_page_fits_native_framing(self):
        with tempfile.TemporaryDirectory() as folder:
            store = DataStore(Path(folder)/'archive.sqlite3')
            try:
                jobs = PublicMediaJobs(store.db)
                request = {'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70','author':'author-sec','url':'https://www.douyin.com/video/70'}
                job = jobs.submit(request)
                claim = jobs.claim('worker')
                jobs.bind_media(job['id'], claim['lease'], 'a'*64)
                for i in range(9):
                    segment = {'kind':'transcript','startMs':i*4000,'endMs':(i+1)*4000,'text':'😀'*1200,'speaker':'unknown'}
                    jobs.checkpoint(job['id'], claim['lease'], [segment], cursor_ms=(i+1)*4000)
                page = handle(store, {'action':'public-media','operation':'evidence','room':'1','anchor':'10','job':job['id']})
                self.assertEqual(len(page), 8)
                output = io.BytesIO()
                write_message({'id':'page','value':page}, output)
                self.assertLess(len(output.getvalue()), 65536)
                next_page = handle(store, {'action':'public-media','operation':'evidence','room':'1','anchor':'10','job':job['id'],'offset':8})
                self.assertEqual(len(next_page), 1)
            finally:
                store.close()

    def test_native_host_uses_archive_database_and_does_not_expose_worker_fence(self):
        with tempfile.TemporaryDirectory() as folder:
            store=DataStore(Path(folder)/'archive.sqlite3')
            try:
                request={'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70','author':'author-sec','url':'https://www.douyin.com/video/70'}
                value=handle(store,{'action':'public-media','operation':'submit','request':request})
                self.assertEqual(value['status'],'queued')
                self.assertNotIn('lease',value)
                self.assertEqual(handle(store,{'action':'public-media','operation':'list','room':'1','anchor':'10'})[0]['id'],value['id'])
                with self.assertRaisesRegex(ValueError,'SCOPE'):
                    handle(store,{'action':'public-media','operation':'evidence','room':'2','anchor':'10','job':value['id']})
                result=handle(store,{'action':'public-media','operation':'forget','room':'1','anchor':'10','subject':'uid:2','epoch':0})
                self.assertEqual(result,{'epoch':1})
                backup=Path(folder)/'copy.sqlite3'
                store.backup(backup)
            finally:
                store.close()
            restored=DataStore(backup)
            try:
                self.assertEqual(handle(restored,{'action':'public-media','operation':'list','room':'1','anchor':'10'})[0]['status'],'cancelled')
            finally:
                restored.close()
