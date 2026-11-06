from pathlib import Path
import tempfile
import threading
import time
import json
import types
import unittest
from unittest.mock import patch

from model_lease import ModelLease
from local_asr import LocalASR


class ModelLeaseContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = 1800000000000

    def tearDown(self):
        self.temp.cleanup()

    def test_one_model_owner_and_live_request_preempts_background_at_next_segment_boundary(self):
        first = ModelLease(self.root, now=lambda: self.now)
        live = ModelLease(self.root, now=lambda: self.now)
        try:
            first.acquire('background')
            with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                live.acquire('live')
            self.assertTrue(first.preempted())
            first.close()
            live.acquire('live')
            self.assertFalse(live.preempted())
            with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                first.acquire('background')
        finally:
            first.close()
            live.close()

    def test_installer_diagnostics_release_model_even_when_used_as_a_library(self):
        from diagnose import self_test
        (self.root/'runtime.json').write_text(json.dumps({'ffmpeg':'fixture','asrModelDir':str(self.root)}))
        (self.root/'test_wavs').mkdir()
        (self.root/'test_wavs/zh.wav').write_bytes(b'fixture')
        runtime = LocalASR(self.root)
        def prepare():
            runtime.recognizer = object()
            return {'phase':'ready'}
        modules = {'streamget':types.SimpleNamespace(), 'websockets.asyncio.client':types.SimpleNamespace(connect=None)}
        contender = ModelLease(self.root)
        try:
            with patch.dict('sys.modules', modules), patch('diagnose.subprocess.run', return_value=types.SimpleNamespace(stdout=b'x'*3200)), patch('local_asr.LocalASR', return_value=runtime), patch.object(runtime, '_prepare', side_effect=prepare), patch.object(runtime, 'decode', return_value='你好'), patch('local_asr.pcm16', return_value=b'fixture'):
                self.assertTrue(self_test(self.root)['ready'])
            contender.acquire('background')
            self.assertIsNone(runtime.recognizer)
        finally:
            runtime.close()
            contender.close()

    def test_stale_live_intent_does_not_permanently_block_background(self):
        first = ModelLease(self.root, now=lambda: self.now)
        live = ModelLease(self.root, now=lambda: self.now)
        try:
            first.acquire('background')
            with self.assertRaises(ValueError):
                live.acquire('live')
            first.close()
            self.now += 61000
            first.acquire('background')
            self.assertFalse(first.preempted())
        finally:
            first.close()
            live.close()

    def test_live_prepare_waits_for_background_to_unload_then_obtains_the_model_lease(self):
        background, live = LocalASR(self.root), LocalASR(self.root)
        loaded = []
        def prepare(runtime, label):
            self.assertIsNone(background.recognizer if label=='live' else live.recognizer)
            runtime.recognizer = object()
            runtime.status['phase'] = 'ready'
            loaded.append(label)
            return runtime.status
        errors = []
        with patch.object(background, '_prepare', side_effect=lambda: prepare(background, 'background')), patch.object(live, '_prepare', side_effect=lambda: prepare(live, 'live')):
            background.prepare(priority='background')
            def request_live():
                try:
                    live.prepare()
                except Exception as error:
                    errors.append(error)
            thread = threading.Thread(target=request_live)
            thread.start()
            try:
                deadline = time.monotonic()+2
                while not background.lease.preempted() and time.monotonic()<deadline:
                    time.sleep(.01)
                with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_PREEMPTED'):
                    background.infer('unused')
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertEqual(loaded, ['background', 'live'])
                self.assertEqual(background.status['phase'], 'unprepared')
            finally:
                background.close()
                live.close()


if __name__ == '__main__':
    unittest.main()
