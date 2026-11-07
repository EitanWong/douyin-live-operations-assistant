import asyncio
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import weakref
from unittest.mock import patch

from data_location import DataLocation
from local_asr import LocalASR
from model_lease import ModelLease
from public_media_jobs import PublicMediaJobs
from public_media_frames import extract_keyframe
from public_media_worker import DownloadedMedia, PublicMediaWorker


class ControlledRecognizer:
    pass


@unittest.skipUnless(shutil.which('ffmpeg'), 'real FFmpeg required')
class PublicMediaHandoffContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.location = DataLocation(settings=self.root/'settings.json', database=str(self.root/'archive.sqlite3'))
        self.path = self.root/'media.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                        '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=10:d=2',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=2',
                        '-c:v', 'mpeg4', '-c:a', 'aac', '-threads', '1', str(self.path)],
                       check=True, capture_output=True)
        self.asr = LocalASR(self.root/'controlled-model')
        self.references = []
        self.prepares = 0

        def prepare():
            self.prepares += 1
            self.asr.recognizer = ControlledRecognizer()
            self.references.append(weakref.ref(self.asr.recognizer))
            self.asr.status['phase'] = 'ready'
            return self.asr.status

        # Exercise real preparation ownership, OS lease and close without optional model packages.
        self.asr._prepare = prepare
        self.asr.decode = lambda frames: '受控转录。'
        self.job = self.call('submit', {'room':'1','anchor':'10','subject':'uid:2','epoch':0,
                                      'workId':'70','author':'author-sec',
                                      'url':'https://www.douyin.com/video/70','visualVersion':1})

    async def asyncTearDown(self):
        self.asr.close()
        self.temp.cleanup()

    def call(self, method, *args, **kwargs):
        with self.location.open() as store:
            return getattr(PublicMediaJobs(store.db), method)(*args, **kwargs)

    async def download(self, job, folder):
        path = folder/'media.mp4'
        shutil.copyfile(self.path, path)
        return DownloadedMedia(path, 2000)

    def worker(self, visual):
        return PublicMediaWorker(self.location, self.asr, shutil.which('ffmpeg'), download=self.download,
                                 visual=visual, heartbeat_seconds=.01)

    def assert_handoff(self):
        self.assertIsNone(self.asr.recognizer, 'ASR weights must be released before visual inference')
        self.assertTrue(all(reference() is None for reference in self.references))
        self.assertEqual(self.asr.status['phase'], 'unprepared')
        self.assertEqual(self.asr.lease.priority, 'background')
        self.assertIsNotNone(self.asr.lease.fd)
        competitor = ModelLease(self.asr.folder)
        try:
            with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                competitor.acquire('background')
        finally:
            competitor.close()
        with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_NOT_READY'):
            self.asr.infer('not decoded after unload')

    def assert_closed(self):
        self.assertIsNone(self.asr.recognizer)
        self.assertIsNone(self.asr.lease.fd)
        self.assertTrue(all(reference() is None for reference in self.references))

    async def test_audio_weights_are_gone_at_every_visual_callback_while_same_lease_blocks_other_models(self):
        seen, leases, retained = [], [], []
        async def visual(job, frame):
            retained.append(self.asr.recognizer is not None)
            if not retained[-1]:
                self.assert_handoff()
            seen.append(frame.at_ms)
            leases.append(self.asr.lease.fd)
            return {'text':'蓝色背景。','model':'controlled-visual'}
        result = await self.worker(visual).run_once()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(seen, [0, 1000])
        self.assertEqual(retained, [False, False], 'no speech model may remain during visual inference')
        self.assertEqual(len(set(leases)), 1)
        self.assertEqual(self.prepares, 1)
        self.assertTrue(any(row['kind']=='transcript' and row['text']=='受控转录。'
                            for row in self.call('evidence', self.job['id'])))
        self.assert_closed()

    async def test_live_request_cancels_pending_visual_and_resume_never_reloads_completed_audio(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()
        seen = []
        async def visual(job, frame):
            self.assert_handoff()
            seen.append(frame.at_ms)
            if len(seen) == 1:
                return {'text':'蓝色背景。','model':'controlled-visual'}
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        task = asyncio.create_task(self.worker(visual).run_once())
        try:
            await asyncio.wait_for(entered.wait(), 3)
            live = ModelLease(self.asr.folder)
            live.request_live()
            result = await asyncio.wait_for(task, 3)
            self.assertEqual((result['status'], result['error']), ('paused', 'live-asr'))
            self.assertEqual(result['visual']['completed'], 1)
            self.assertTrue(cancelled.is_set())
            self.assert_closed()
            try:
                live.acquire('live')
            finally:
                live.close()
            with self.location.open() as store:
                store.db.execute('UPDATE public_media_jobs SET not_before=0')
                store.db.commit()
            resumed = []
            async def finish(job, frame):
                self.assert_handoff()
                resumed.append(frame.at_ms)
                return {'text':'','model':'controlled-visual'}
            with patch.object(self.asr, '_prepare', side_effect=AssertionError('completed audio must not reload')):
                result = await self.worker(finish).run_once()
            self.assertEqual(result['status'], 'succeeded')
            self.assertEqual(resumed, [seen[-1]])
            self.assertEqual(self.prepares, 1)
            self.assert_closed()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_cancelled_worker_drains_visual_before_releasing_reserved_lease(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()
        async def visual(job, frame):
            self.assert_handoff()
            entered.set()
            try:
                await asyncio.Future()
            finally:
                self.assertIsNotNone(self.asr.lease.fd)
                cancelled.set()
        task = asyncio.create_task(self.worker(visual).run_once())
        try:
            await asyncio.wait_for(entered.wait(), 3)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(cancelled.is_set())
            self.assert_closed()
            self.assertFalse(any(row['kind']=='visual' for row in self.call('evidence', self.job['id'])))
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_live_intent_during_frame_decode_prevents_the_next_visual_model_call(self):
        live, calls = ModelLease(self.asr.folder), []
        async def decoded(*args):
            frame = await extract_keyframe(*args)
            live.request_live()
            return frame
        async def visual(job, frame):
            calls.append(frame.at_ms)
            return {'text':'must not run','model':'controlled-visual'}
        with patch('public_media_worker.extract_keyframe', side_effect=decoded):
            result = await self.worker(visual).run_once()
        self.assertEqual((result['status'], result['error']), ('paused', 'live-asr'))
        self.assertEqual(calls, [])
        self.assertEqual(result['visual']['completed'], 0)
        self.assert_closed()
