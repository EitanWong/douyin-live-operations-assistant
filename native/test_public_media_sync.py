import tempfile
import unittest
from pathlib import Path

from data_store import DataStore
from data_host import handle
from public_media_jobs import PublicMediaJobs


class BrowserMediaSynchronization(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=DataStore(Path(self.temp.name)/'archive.sqlite3')
        self.jobs=PublicMediaJobs(self.store.db)
        self.request={'room':'1','anchor':'10','subject':'uid:2','epoch':0,'author':'author-sec','workId':'70','url':'https://www.douyin.com/video/70','knowledgeVersion':4}

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def api(self,operation,**changes):
        return handle(self.store,{'action':'public-media','operation':operation,'room':'1','anchor':'10','subject':'uid:2',**changes})

    def test_timestamp_epoch_is_authoritative_and_disabling_cannot_be_bypassed_by_late_submit(self):
        self.api('sync',epoch=0,allowed=True)
        job=self.api('submit',request=self.request)
        claim=self.jobs.claim('worker')
        self.jobs.bind_media(job['id'],claim['lease'],'a'*64)
        self.jobs.checkpoint(job['id'],claim['lease'],[{'kind':'transcript','startMs':0,'endMs':4000,'speaker':'unknown','text':'茶杯不能加热'}],cursor_ms=4000)
        latest=1800000000100
        self.assertEqual(self.api('sync',epoch=latest,allowed=True),{'epoch':latest})
        self.assertEqual(self.jobs.get(job['id'])['status'],'cancelled')
        self.assertEqual(self.jobs.evidence(job['id']),[])
        with self.assertRaisesRegex(ValueError,'EPOCH'):
            self.api('submit',request=self.request)
        with self.assertRaisesRegex(ValueError,'EPOCH'):
            self.api('sync',epoch=0,allowed=True)
        self.assertEqual(self.api('sync',epoch=0,allowed=False),{'epoch':latest})
        self.api('sync',epoch=latest,allowed=False)
        with self.assertRaisesRegex(ValueError,'DISABLED'):
            self.api('submit',request={**self.request,'epoch':latest})
        self.api('sync',epoch=latest,allowed=True)
        current=self.api('submit',request={**self.request,'epoch':latest})
        self.assertEqual(current['epoch'],latest)
        self.assertEqual(current['knowledgeVersion'],4)

    def test_import_cursor_only_acknowledges_committed_succeeded_evidence_and_survives_restart(self):
        self.api('sync',epoch=0,allowed=True)
        job=self.api('submit',request=self.request)
        with self.assertRaisesRegex(ValueError,'IMPORT'):
            self.api('ack',job=job['id'],cursor=1,complete=True)
        claim=self.jobs.claim('worker')
        self.jobs.bind_media(job['id'],claim['lease'],'a'*64)
        self.jobs.checkpoint(job['id'],claim['lease'],[{'kind':'transcript','startMs':0,'endMs':4000,'speaker':'unknown','text':'茶杯不能加热'}],cursor_ms=4000)
        self.jobs.complete(job['id'],claim['lease'],4000)
        with self.assertRaisesRegex(ValueError,'IMPORT'):
            self.api('ack',job=job['id'],cursor=2,complete=True)
        acknowledged=self.api('ack',job=job['id'],cursor=1,complete=True)
        self.assertTrue(acknowledged['imported'])
        self.assertEqual(acknowledged['importCursor'],1)
        self.assertIsInstance(acknowledged['updatedAt'],int)
        with self.assertRaisesRegex(ValueError,'SCOPE'):
            self.api('ack',job=job['id'],room='2',cursor=1,complete=True)
        self.store.close()
        self.store=DataStore(Path(self.temp.name)/'archive.sqlite3')
        self.assertTrue(self.api('get',job=job['id'])['imported'])
        self.jobs=PublicMediaJobs(self.store.db)

    def test_reconcile_erases_imported_history_beyond_one_job_page_and_missing_canonical_memory(self):
        ids=[]
        self.api('sync',epoch=0,allowed=True)
        for index in range(36):
            work=str(100+index)
            job=self.api('submit',request={**self.request,'workId':work,'url':'https://www.douyin.com/video/'+work})
            claim=self.jobs.claim('worker')
            self.jobs.bind_media(job['id'],claim['lease'],'a'*64)
            self.jobs.checkpoint(job['id'],claim['lease'],[{'kind':'transcript','startMs':0,'endMs':4000,'text':'原话','speaker':'unknown'}],cursor_ms=4000)
            self.jobs.complete(job['id'],claim['lease'],4000)
            self.api('ack',job=job['id'],cursor=1,complete=True)
            ids.append(job['id'])
        self.assertEqual(len(self.jobs.list('1','10')),32)
        self.assertEqual(self.api('scopes'),[{'room':'1','anchor':'10'}])
        self.api('reconcile',privacy={'present':True,'forgetBefore':0,'forgotten':[{'key':'uid:2','at':1800000000100}]},allowed=True)
        for job_id in ids:
            self.assertEqual(self.jobs.evidence(job_id),[])
            self.assertEqual(self.jobs.get(job_id)['status'],'cancelled')
        self.assertEqual(self.jobs.current_epoch('1','10','uid:2'),1800000000100)
        current=self.api('submit',request={**self.request,'epoch':1800000000100})
        self.api('reconcile',privacy={'present':False,'forgetBefore':0,'forgotten':[]},allowed=True)
        self.assertEqual(self.jobs.get(current['id'])['status'],'cancelled')

    def test_scope_paging_visits_every_archived_room_and_reenable_requires_a_new_submission(self):
        for index in range(65):
            self.jobs.sync_subject(str(index+1),'10','uid:2',0,True)
        first=self.api('scopes')
        second=self.api('scopes',after=[first[-1]['room'],first[-1]['anchor']])
        self.assertEqual(len(first),64)
        self.assertEqual(len(second),1)
        self.assertEqual(len({(row['room'],row['anchor']) for row in first+second}),65)
        job=self.api('submit',request=self.request)
        self.api('sync',epoch=0,allowed=False)
        self.api('sync',epoch=0,allowed=True)
        self.assertIsNone(self.jobs.claim('worker'))
        reopened=self.api('submit',request=self.request)
        self.assertEqual(reopened['id'],job['id'])
        self.assertEqual(reopened['status'],'queued')

    def test_reopening_cancelled_jobs_obeys_the_same_pending_capacity(self):
        old=self.api('submit',request=self.request)
        self.api('cancel',job=old['id'])
        for index in range(32):
            work=str(200+index)
            self.api('submit',request={**self.request,'workId':work,'url':'https://www.douyin.com/video/'+work})
        with self.assertRaisesRegex(ValueError,'QUEUE_FULL'):
            self.api('submit',request=self.request)

    def test_new_media_bytes_reset_previously_acknowledged_import_cursor(self):
        job=self.api('submit',request=self.request)
        claim=self.jobs.claim('worker')
        self.jobs.bind_media(job['id'],claim['lease'],'a'*64)
        self.jobs.checkpoint(job['id'],claim['lease'],[{'kind':'transcript','startMs':0,'endMs':4000,'text':'旧音轨','speaker':'unknown'}],cursor_ms=4000)
        self.jobs.complete(job['id'],claim['lease'],4000)
        self.api('ack',job=job['id'],cursor=1,complete=True)
        self.api('cancel',job=job['id'])
        self.api('submit',request=self.request)
        claim=self.jobs.claim('worker')
        changed=self.jobs.bind_media(job['id'],claim['lease'],'b'*64)
        self.assertEqual(changed['importCursor'],0)
        self.assertFalse(changed['imported'])
        self.assertEqual(self.jobs.evidence(job['id']),[])

    def test_transient_page_source_is_bound_persisted_redacted_and_removed_on_forget(self):
        now=self.jobs.now()
        source={'workId':'70','author':'author-sec','authorUid':'2','url':'https://v1.example.douyinvod.com/file?__vid=70',
                'durationMs':4000,'observedAt':now,'expiresAt':now+300000}
        job=self.api('submit',request={**self.request,'pageMedia':source})
        self.assertNotIn('pageMedia',job)
        self.store.close();self.store=DataStore(Path(self.temp.name)/'archive.sqlite3');self.jobs=PublicMediaJobs(self.store.db)
        claim=self.jobs.claim('worker');self.assertEqual(self.jobs.source(job['id'],claim['lease']),source)
        self.api('sync',epoch=now+1,allowed=True)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM public_media_sources').fetchone()[0],0)
        with self.assertRaisesRegex(ValueError,'LEASE'):self.jobs.source(job['id'],claim['lease'])

    def test_expired_source_is_not_used_and_fresh_source_can_reopen_a_failed_job(self):
        now=1800000000000;self.jobs.now=lambda:now
        source={'workId':'70','author':'author-sec','authorUid':'2','url':'https://v1.example.douyinvod.com/file?__vid=70',
                'durationMs':4000,'observedAt':now,'expiresAt':now+300000}
        job=self.jobs.submit({**self.request,'pageMedia':source});now+=300000
        claim=self.jobs.claim('worker');self.assertIsNone(self.jobs.source(job['id'],claim['lease']))
        for _ in range(3):
            if claim is None:claim=self.jobs.claim('worker')
            self.jobs.fail(job['id'],claim['lease'],'MEDIA_DOWNLOAD_FAILED');claim=None;now+=300000
        self.assertEqual(self.jobs.get(job['id'])['status'],'failed')
        updated=self.jobs.submit({**self.request,'pageMedia':{**source,'observedAt':now,'expiresAt':now+300000}})
        self.assertEqual(updated['id'],job['id']);self.assertEqual(updated['status'],'queued')

    def test_disable_and_cancel_remove_transient_sources_and_invalid_late_source_cannot_restore_them(self):
        now=self.jobs.now()
        source={'workId':'70','author':'author-sec','authorUid':'2','url':'https://v1.example.douyinvod.com/file?__vid=70',
                'durationMs':4000,'observedAt':now,'expiresAt':now+300000}
        for operation in ['cancel','disable']:
            self.api('sync',epoch=0,allowed=True)
            job=self.api('submit',request={**self.request,'pageMedia':source})
            if operation=='cancel':self.api('cancel',job=job['id'])
            else:self.api('sync',epoch=0,allowed=False)
            self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM public_media_sources').fetchone()[0],0)
        with self.assertRaisesRegex(ValueError,'DISABLED'):
            self.api('submit',request={**self.request,'pageMedia':source})


if __name__=='__main__':
    unittest.main()
