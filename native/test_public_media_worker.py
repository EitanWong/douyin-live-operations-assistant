import asyncio
import base64
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

from data_location import DataLocation
from local_asr import pcm16
from public_media_jobs import PublicMediaJobs
from public_media_worker import DownloadedMedia, PublicMediaWorker, download_public_video, run_bounded, verify_metadata


class FakeASR:
    def __init__(self, preempt_at=None):
        self.calls = []
        self.closed = False
        self.preempt_at = preempt_at
        self.preempted = False

    def reserve(self, priority):
        assert priority == 'background'

    def prepare(self, priority):
        assert priority == 'background'
        return {'phase': 'ready'}

    def infer(self, value):
        if len(self.calls) == self.preempt_at:
            raise ValueError('LOCAL_ASR_PREEMPTED')
        frames = pcm16(value)
        self.calls.append(len(frames))
        return '茶杯只可盛冷水。' if any(frames) else ''

    def check_priority(self):
        if self.preempted:
            raise ValueError('LOCAL_ASR_PREEMPTED')

    def close(self):
        self.closed = True

    def unload(self):
        pass


@unittest.skipUnless(shutil.which('ffmpeg'), 'real FFmpeg required')
class PublicMediaWorkerContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.location = DataLocation(settings=root/'settings.json', database=str(root/'archive.sqlite3'))
        self.request = {'room': '1', 'anchor': '10', 'subject': 'uid:2', 'epoch': 0,
                        'workId': '70', 'author': 'author-sec', 'url': 'https://www.douyin.com/video/70'}
        self.audio = root/'source.wav'
        with wave.open(str(self.audio), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x01\x02'*128000 + b'\x00\x00'*6400)
        self.job = self.call('submit', self.request)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def call(self, method, *args, **kwargs):
        with self.location.open() as store:
            return getattr(PublicMediaJobs(store.db), method)(*args, **kwargs)

    async def download(self, job, folder):
        target = folder/'media.wav'
        shutil.copyfile(self.audio, target)
        return DownloadedMedia(target, 8400)

    def worker(self, asr=None, download=None):
        return PublicMediaWorker(self.location, asr or FakeASR(), shutil.which('ffmpeg'),
                                 download=download or self.download, heartbeat_seconds=.02)

    async def test_real_decoder_transcribes_whole_audio_and_preserves_silence_and_source_hash(self):
        asr = FakeASR()
        result = await self.worker(asr).run_once()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['coverage'], {'audio': 'complete', 'durationMs': 8400,
                                            'video': 'not-analyzed', 'speaker': 'unknown'})
        self.assertEqual(asr.calls, [128000, 128000, 12800])
        self.assertTrue(asr.closed)
        evidence = self.call('evidence', self.job['id'])
        self.assertEqual([r['text'] for r in evidence], ['茶杯只可盛冷水。', '茶杯只可盛冷水。', ''])
        self.assertEqual([r['startMs'] for r in evidence], [0, 4000, 8000])
        self.assertEqual(len(result['mediaHash']), 64)

    async def test_page_attributed_source_passes_real_httpx_stream_and_ffmpeg_without_extractor(self):
        import httpx
        from public_media_source import download_page_media
        now=self.call('get',self.job['id'])['createdAt'];seen=[]
        source={'workId':'70','author':'author-sec','authorUid':'2','url':'https://v1.example.douyinvod.com/file?__vid=70',
                'durationMs':8400,'observedAt':now,'expiresAt':now+300000}
        self.call('submit',{**self.request,'pageMedia':source})
        async def handler(request):
            seen.append(request)
            return httpx.Response(200,headers={'Content-Type':'video/mp4'},content=self.audio.read_bytes())
        async def download(value,folder):return await download_page_media(value,folder,transport=httpx.MockTransport(handler))
        with patch('public_media_worker.download_page_media',side_effect=download),patch('public_media_worker.run_bounded',side_effect=AssertionError('extractor must not run')):
            result=await PublicMediaWorker(self.location,FakeASR(),shutil.which('ffmpeg')).run_once()
        self.assertEqual(result['status'],'succeeded');self.assertEqual(result['coverage']['durationMs'],8400)
        self.assertEqual(str(seen[0].url),source['url']);self.assertNotIn('cookie',seen[0].headers)
        self.assertEqual(len(self.call('evidence',self.job['id'])),3)
        with self.location.open() as store:self.assertEqual(store.db.execute('SELECT COUNT(*) FROM public_media_sources').fetchone()[0],0)

    async def test_live_preemption_resumes_after_committed_segment_without_duplicate_evidence(self):
        asr = FakeASR(preempt_at=1)
        result = await self.worker(asr).run_once()
        self.assertEqual(result['status'], 'paused')
        self.assertEqual(result['cursorMs'], 4000)
        self.assertTrue(asr.closed)
        # Advance the queue's backoff in the fixture, without waiting in production.
        with self.location.open() as store:
            store.db.execute('UPDATE public_media_jobs SET not_before=0')
            store.db.commit()
        resumed = FakeASR()
        result = await self.worker(resumed).run_once()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(resumed.calls, [128000, 12800])
        self.assertEqual(len(self.call('evidence', self.job['id'])), 3)

    async def test_live_request_cancels_download_and_releases_background_model_without_waiting_for_network(self):
        started, cancelled = asyncio.Event(), asyncio.Event()
        asr = FakeASR()
        async def download(job, folder):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        task = asyncio.create_task(self.worker(asr, download).run_once())
        await asyncio.wait_for(started.wait(), 2)
        asr.preempted = True
        try:
            result = await asyncio.wait_for(asyncio.shield(task), .3)
            self.assertEqual(result['status'], 'paused')
            self.assertEqual(result['error'], 'live-asr')
            self.assertTrue(asr.closed)
            self.assertTrue(cancelled.is_set())
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_forget_cancels_inflight_download_and_fences_late_results(self):
        started, cancelled = asyncio.Event(), asyncio.Event()
        async def download(job, folder):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        worker = self.worker(download=download)
        task = asyncio.create_task(worker.run_once())
        await asyncio.wait_for(started.wait(), 2)
        self.call('forget', '1', '10', 'uid:2', 0)
        result = await asyncio.wait_for(task, 2)
        self.assertEqual(result['status'], 'cancelled')
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.call('evidence', self.job['id']), [])

    async def test_forget_during_inference_joins_model_before_unloading_and_discards_result(self):
        started, finish = threading.Event(), threading.Event()
        asr = FakeASR()
        original = asr.infer
        def blocking_infer(value):
            started.set()
            finish.wait(2)
            return original(value)
        asr.infer = blocking_infer
        task = asyncio.create_task(self.worker(asr).run_once())
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 2))
            self.call('forget', '1', '10', 'uid:2', 0)
            await asyncio.sleep(.08)
            self.assertFalse(asr.closed)
            self.assertFalse(task.done())
        finally:
            finish.set()
        result = await asyncio.wait_for(task, 2)
        self.assertEqual(result['status'], 'cancelled')
        self.assertTrue(asr.closed)
        self.assertEqual(self.call('evidence', self.job['id']), [])

    async def test_archive_relocation_during_download_keeps_job_and_writes_only_to_current_archive(self):
        with self.location.open() as store:
            source = str(store.path)
        # Follow settings instead of a CLI-fixed path for this migration fixture.
        self.location.override = None
        self.location.fallback = Path(source)
        target = Path(self.temp.name)/'relocated'
        async def relocating_download(job, folder):
            self.location.relocate(str(target), source)
            return await self.download(job, folder)
        result = await self.worker(download=relocating_download).run_once()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(len(self.call('evidence', self.job['id'])), 3)
        from data_store import DataStore
        store = DataStore(source)
        try:
            self.assertEqual(PublicMediaJobs(store.db).evidence(self.job['id']), [])
        finally:
            store.close()

    async def test_truncated_audio_cannot_be_claimed_complete_against_source_duration(self):
        async def download(job, folder):
            downloaded = await self.download(job, folder)
            return DownloadedMedia(downloaded.path, 20000)
        result = await self.worker(download=download).run_once()
        self.assertEqual(result['status'], 'paused')
        self.assertEqual(result['error'], 'MEDIA_DECODE_FAILED')
        self.assertEqual(result['coverage']['audio'], 'pending')

    async def test_corrupt_media_is_retryable_and_cannot_claim_full_audio(self):
        self.audio.write_bytes(b'not media')
        result = await self.worker().run_once()
        self.assertEqual(result['status'], 'paused')
        self.assertEqual(result['error'], 'MEDIA_DECODE_FAILED')
        self.assertEqual(result['coverage']['audio'], 'pending')
        self.assertEqual(self.call('evidence', self.job['id']), [])


class PublicMediaBoundaryContracts(unittest.IsolatedAsyncioTestCase):
    async def test_bounded_process_limits_output_and_reaps_on_cancellation(self):
        import sys
        with self.assertRaisesRegex(ValueError, 'MEDIA_DOWNLOAD_FAILED'):
            await run_bounded([sys.executable, '-c', 'print("x"*300000)'], timeout=2, maximum=1024)
        task = asyncio.create_task(run_bounded([sys.executable, '-c', 'import time;time.sleep(60)'], timeout=10))
        await asyncio.sleep(.05)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 2)

    async def test_download_rejects_author_changed_after_initial_metadata_check(self):
        import json
        job = {'workId':'70','author':'author-sec','subject':'sec:author-sec','url':'https://www.douyin.com/video/70'}
        initial = {'id':'70','channel_id':'author-sec','duration':8.4,'extractor_key':'Douyin'}
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            calls = []
            async def command(args, **kwargs):
                calls.append(args)
                if len(calls) == 1:
                    return json.dumps(initial).encode()
                (folder/'media.info.json').write_text(json.dumps({**initial,'channel_id':'other-author'}))
                (folder/'media.mp4').write_bytes(b'fixture')
                return b''
            with patch('public_media_worker.run_bounded', side_effect=command):
                with self.assertRaisesRegex(ValueError, 'MEDIA_AUTHOR_MISMATCH'):
                    await download_public_video(job, folder)
            self.assertEqual(len(calls), 2)

    async def test_stable_author_and_work_id_must_match_both_metadata_reads(self):
        request = {'workId': '70', 'author': 'author-sec', 'subject': 'uid:2', 'url': 'https://www.douyin.com/video/70'}
        metadata = {'id': '70', 'channel_id': 'author-sec', 'duration': 8.4, 'extractor_key': 'Douyin', 'uploader_id': '2'}
        self.assertEqual(verify_metadata(metadata, request), 8400)
        for changes in [{'uploader_id': '3'}, {'channel_id': 'another-author'}, {'id': '71'}, {'extractor_key': 'Generic'},
                        {'duration': None}, {'duration': float('inf')}, {'duration': 20000}, {'_type': 'playlist'}]:
            with self.assertRaises(ValueError):
                verify_metadata({**metadata, **changes}, request)


if __name__ == '__main__':
    unittest.main()
