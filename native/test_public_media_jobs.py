import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from public_media_jobs import PublicMediaJobs


class PublicMediaJobContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'archive.sqlite3'
        self.now = 1800000000000
        self.db = sqlite3.connect(self.path)
        self.store = PublicMediaJobs(self.db, now=lambda: self.now)
        self.request = {'room': '1', 'anchor': '10', 'subject': 'uid:2', 'epoch': 0,
                        'workId': '70', 'author': 'author-sec', 'url': 'https://www.douyin.com/video/70'}

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def claim(self, worker):
        job = self.store.claim(worker)
        if job:
            self.store.bind_media(job['id'], job['lease'], 'a'*64)
        return job

    def segment(self, **changes):
        return {'kind': 'transcript', 'startMs': 0, 'endMs': 4000,
                'text': '陶瓷茶杯只限冷水，不可加热。', 'speaker': 'unknown', **changes}

    def test_submission_is_idempotent_and_restart_recovers_expired_lease_with_a_new_fence(self):
        job = self.store.submit(self.request)
        self.assertEqual(self.store.submit(self.request)['id'], job['id'])
        claim = self.claim('worker-one')
        self.assertEqual(claim['id'], job['id'])
        self.assertIsNone(self.claim('worker-two'))
        self.store.checkpoint(claim['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.db.close()
        self.db = sqlite3.connect(self.path)
        self.store = PublicMediaJobs(self.db, now=lambda: self.now)
        self.now += 61000
        resumed = self.claim('worker-two')
        self.assertEqual(resumed['cursorMs'], 4000)
        self.assertNotEqual(resumed['lease'], claim['lease'])
        with self.assertRaisesRegex(ValueError, 'LEASE'):
            self.store.checkpoint(claim['id'], claim['lease'], [self.segment(startMs=4000, endMs=8000)], cursor_ms=8000)
        self.assertEqual(len(self.store.evidence(job['id'])), 1)

    def test_forget_invalidates_running_and_queued_jobs_and_blocks_late_results_and_old_submissions(self):
        job = self.store.submit(self.request)
        claim = self.claim('worker-one')
        self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        queued = self.store.submit({**self.request, 'workId': '71', 'url': 'https://www.douyin.com/video/71'})
        self.assertEqual(self.store.forget('1', '10', 'uid:2', 0), 1)
        for row in [job, queued]:
            self.assertEqual(self.store.get(row['id'])['status'], 'cancelled')
            self.assertEqual(self.store.evidence(row['id']), [])
        with self.assertRaisesRegex(ValueError, 'LEASE|EPOCH'):
            self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        with self.assertRaisesRegex(ValueError, 'EPOCH'):
            self.store.submit(self.request)
        self.assertNotEqual(self.store.submit({**self.request, 'epoch': 1})['id'], job['id'])

    def test_cancel_cannot_be_undone_by_worker_completion_and_other_scopes_are_unchanged(self):
        first = self.store.submit(self.request)
        self.now += 1
        other = self.store.submit({**self.request, 'room': '2'})
        claim = self.claim('worker-one')
        self.store.cancel(first['id'], '1', '10')
        with self.assertRaisesRegex(ValueError, 'LEASE'):
            self.store.complete(first['id'], claim['lease'], duration_ms=4000)
        self.assertEqual(self.store.get(other['id'])['status'], 'queued')
        with self.assertRaisesRegex(ValueError, 'SCOPE'):
            self.store.cancel(other['id'], '1', '10')

    def test_transcript_segments_are_atomic_idempotent_and_completion_requires_contiguous_full_audio(self):
        job = self.store.submit(self.request)
        claim = self.claim('worker-one')
        self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.assertEqual(len(self.store.evidence(job['id'])), 1)
        with self.assertRaisesRegex(ValueError, 'COVERAGE'):
            self.store.complete(job['id'], claim['lease'], duration_ms=8000)
        with self.assertRaisesRegex(ValueError, 'SEGMENT'):
            self.store.checkpoint(job['id'], claim['lease'], [self.segment(startMs=4000, endMs=8000), self.segment(speaker='author')], cursor_ms=8000)
        self.assertEqual(len(self.store.evidence(job['id'])), 1)
        self.store.checkpoint(job['id'], claim['lease'], [self.segment(startMs=4000, endMs=8000, text='')], cursor_ms=8000)
        result = self.store.complete(job['id'], claim['lease'], duration_ms=8000)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['coverage']['audio'], 'complete')
        self.assertEqual(result['coverage']['video'], 'not-analyzed')
        self.assertEqual(self.store.evidence(job['id'])[1]['text'], '')

    def test_priority_pause_preserves_checkpoint_and_releases_worker_lease(self):
        job = self.store.submit(self.request)
        claim = self.claim('background')
        self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.store.pause(job['id'], claim['lease'], 'live-asr', delay_ms=1000)
        self.assertIsNone(self.claim('background'))
        self.now += 1000
        resumed = self.claim('background')
        self.assertEqual(resumed['cursorMs'], 4000)
        self.assertNotEqual(resumed['lease'], claim['lease'])

    def test_changed_download_restarts_transcript_instead_of_stitching_different_media(self):
        job = self.store.submit(self.request)
        claim = self.store.claim('worker')
        with self.assertRaisesRegex(ValueError, 'MEDIA_UNBOUND'):
            self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.store.bind_media(job['id'], claim['lease'], 'a'*64)
        self.store.checkpoint(job['id'], claim['lease'], [self.segment()], cursor_ms=4000)
        self.store.bind_media(job['id'], claim['lease'], 'a'*64)
        self.assertEqual(self.store.get(job['id'])['cursorMs'], 4000)
        self.store.bind_media(job['id'], claim['lease'], 'b'*64)
        self.assertEqual(self.store.get(job['id'])['cursorMs'], 0)
        self.assertEqual(self.store.evidence(job['id']), [])
        self.assertEqual(self.store.get(job['id'])['mediaHash'], 'b'*64)
        self.store.forget('1', '10', 'uid:2', 0)
        self.assertIsNone(self.store.get(job['id'])['mediaHash'])

    def test_two_archive_connections_share_one_worker_and_bounded_retry_backoff(self):
        self.store.submit(self.request)
        db2 = sqlite3.connect(self.path)
        second = PublicMediaJobs(db2, now=lambda:self.now)
        try:
            for attempt in range(3):
                claim = self.claim('first')
                self.assertIsNotNone(claim)
                self.assertIsNone(second.claim('second'))
                second.fail(claim['id'], claim['lease'], 'MEDIA_DOWNLOAD_FAILED')
                self.assertIsNone(self.store.claim('first'))
                self.now += 60000*(attempt+1)
            self.assertEqual(self.store.get(claim['id'])['status'], 'failed')
            self.assertIsNone(second.claim('second'))
        finally:
            db2.close()

    def test_identity_and_url_boundaries_reject_invalid_jobs_without_storing_payloads(self):
        for changes in [{'url': 'https://www.douyin.com/video/71'}, {'url': 'https://evil.example/video/70'},
                        {'url': 'https://www.douyin.com/video/70?token=secret'}, {'subject': 'nickname:茶友'},
                        {'epoch': -1}, {'author': '../private'}, {'room': 'other'}, {'subject': 42}, {'subject': None}]:
            with self.assertRaises(ValueError):
                self.store.submit({**self.request, **changes})
        self.assertIsNone(self.claim('worker'))
        self.assertNotIn('secret', json.dumps(self.store.list('1', '10')))


if __name__ == '__main__':
    unittest.main()
