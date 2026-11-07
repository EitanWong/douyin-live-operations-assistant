import base64
import io
from pathlib import Path
import tempfile
import threading
import types
import unittest
import wave
import weakref
from unittest.mock import patch
from local_asr import pcm16, clean_transcript, performance_phase, LocalASR
from model_lease import ModelLease

class LocalASRContracts(unittest.TestCase):
    def test_unload_releases_weights_but_holds_model_lease_and_requires_prepare_again(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = LocalASR(folder)
            runtime.reserve('background')
            runtime.recognizer = types.SimpleNamespace()
            runtime.status['phase'] = 'ready'
            descriptor = runtime.lease.fd
            try:
                runtime.unload()
                runtime.unload()
                self.assertIsNone(runtime.recognizer)
                self.assertEqual(runtime.status['phase'], 'unprepared')
                self.assertEqual(runtime.lease.fd, descriptor)
                other = ModelLease(folder)
                try:
                    with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                        other.acquire('background')
                finally:
                    other.close()
                with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_NOT_READY'):
                    runtime.infer('not decoded')
            finally:
                runtime.close()
            self.assertIsNone(runtime.lease.fd)

    def test_unload_waits_for_the_current_model_operation_before_releasing_weights(self):
        runtime = LocalASR(None)
        runtime.recognizer = types.SimpleNamespace()
        entered, finished = threading.Event(), threading.Event()
        def unload():
            entered.set()
            runtime.unload()
            finished.set()
        thread = threading.Thread(target=unload)
        try:
            with runtime.operation_lock:
                thread.start()
                self.assertTrue(entered.wait(1))
                self.assertFalse(finished.wait(.02))
                self.assertIsNotNone(runtime.recognizer)
            thread.join(1)
            self.assertTrue(finished.is_set())
            self.assertIsNone(runtime.recognizer)
        finally:
            thread.join(1)
            runtime.close()

    def test_uninstalled_model_is_unavailable_without_loading_weights(self):
        runtime = LocalASR(None)
        self.assertFalse(runtime.status['available'])
        self.assertEqual(runtime.status['phase'], 'unprepared')
        self.assertIsNone(runtime.recognizer)

    def test_only_bounded_mono_16k_pcm_enters_recognizer(self):
        out = io.BytesIO()
        with wave.open(out, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b'\x00\x00' * 16000)
        samples = pcm16(base64.b64encode(out.getvalue()).decode())
        self.assertEqual(len(samples), 32000)
        for value in ['invalid', base64.b64encode(b'no wav').decode(), 'A' * 900000]:
            with self.assertRaises(ValueError): pcm16(value)

    def test_model_tags_are_removed_and_slow_devices_are_not_ready(self):
        self.assertEqual(clean_transcript('<|zh|><|NEUTRAL|><|Speech|>蓝色怎么样？'), '蓝色怎么样？')
        self.assertEqual(performance_phase(500, 4000), 'ready')
        self.assertEqual(performance_phase(4500, 4000), 'slow')

    def test_short_speech_does_not_fail_only_because_of_fixed_decoder_overhead(self):
        self.assertEqual(performance_phase(240, 300), 'ready')
        self.assertEqual(performance_phase(2100, 4000), 'slow')

    def test_one_scheduling_spike_does_not_permanently_disable_a_ready_recognizer(self):
        runtime = LocalASR(None)
        runtime.status['phase'] = 'ready'
        runtime.decode = lambda frames: '大家好'
        frames = b'\x01\x02' * 16000
        with patch('local_asr.pcm16', return_value=frames), patch('local_asr.time.perf_counter', side_effect=[0, .8, 1, 1.1]):
            self.assertEqual(runtime.infer('sample'), '大家好')
            self.assertEqual(runtime.status['phase'], 'ready')
            self.assertEqual(runtime.infer('sample'), '大家好')
            self.assertEqual(runtime.status['consecutiveOverruns'], 0)

    def test_sustained_overload_still_stops_instead_of_claiming_realtime(self):
        runtime = LocalASR(None)
        runtime.status['phase'] = 'ready'
        runtime.decode = lambda frames: '大家好'
        with patch('local_asr.pcm16', return_value=b'\x01\x02' * 16000), patch('local_asr.time.perf_counter', side_effect=[0, .8, 1, 1.8, 2, 2.8]):
            runtime.infer('sample')
            runtime.infer('sample')
            with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_SLOW'):
                runtime.infer('sample')
            self.assertEqual(runtime.status['phase'], 'slow')


class PreparationOwnershipContracts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        (self.folder / 'test_wavs').mkdir()
        (self.folder / 'model.int8.onnx').write_bytes(b'controlled factory; no model weights')
        (self.folder / 'tokens.txt').write_text('fixture')
        with wave.open(str(self.folder / 'test_wavs/zh.wav'), 'wb') as audio:
            audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            audio.writeframes(b'\xff\x1f' * 64000)
        self.runtime = LocalASR(None)
        self.runtime.folder = self.folder
        self.runtime.lease = ModelLease(self.folder)
        self.addCleanup(self.runtime.close)
        self.live = weakref.WeakSet()
        self.loads = []
        self.overlaps = []
        self.on_load = lambda _threads: None
        self.text = lambda threads: 'threads:' + str(threads)
        class Recognizer:
            def __init__(self, threads):
                self.threads = threads

        def load(**options):
            self.overlaps.append(len(self.live))
            threads = options['num_threads']
            self.loads.append(threads)
            self.on_load(threads)
            model = Recognizer(threads)
            self.live.add(model)
            return model

        factory = types.SimpleNamespace(OfflineRecognizer=types.SimpleNamespace(from_sense_voice=load))
        self.enterContext(patch.dict('sys.modules', {'sherpa_onnx': factory}))
        # Ownership tests run without optional NumPy or speech weights. Keep
        # preparation, allocation, scheduling, self-test decisions and leases real.
        self.enterContext(patch('local_asr.benchmark_frames', side_effect=lambda frames: frames))
        def decode(_frames):
            self.runtime.check_priority()
            return self.text(self.runtime.recognizer.threads)
        self.enterContext(patch.object(self.runtime, 'decode', side_effect=decode))
        self.enterContext(patch('local_asr.os.cpu_count', return_value=8))
        # One thread is fastest; the winning configuration must survive later candidates.
        self.enterContext(patch('local_asr.time.perf_counter', side_effect=lambda: next(self.clock)))
        self.clock = iter([value for delay in [.1, .2, .3] * 2
                           for start in [0, 1, 2] for value in [start, start + delay]])

    def test_prepare_and_reprepare_load_one_model_at_a_time_and_keep_fastest_configuration(self):
        for _ in range(2):
            status = self.runtime.prepare(priority='background')
            self.assertEqual(status['phase'], 'ready')
            self.assertTrue(status['selfTestPassed'])
            self.assertEqual(status['threads'], 1)
            self.assertEqual([row['threads'] for row in status['benchmarks']], [1, 2, 4])
            self.assertEqual(self.runtime.decode(b'\xff\x1f' * 16000), 'threads:1')
            self.assertEqual(len(self.live), 1)
        self.assertEqual(set(self.loads), {1, 2, 4})
        self.assertEqual(self.overlaps, [0] * len(self.overlaps))
        self.runtime.close()
        self.assertEqual(len(self.live), 0)
        self.assertIsNone(self.runtime.lease.fd)

    def test_failed_later_allocation_releases_model_and_lease(self):
        def fail(threads):
            if threads == 2:
                raise RuntimeError('controlled allocation failure')
        self.on_load = fail
        with self.assertRaisesRegex(RuntimeError, 'controlled allocation failure'):
            self.runtime.prepare(priority='background')
        self.assertEqual(self.overlaps, [0, 0])
        self.assertEqual(len(self.live), 0)
        self.assertIsNone(self.runtime.lease.fd)
        self.assertEqual(self.runtime.status['phase'], 'unprepared')

    def test_empty_transcript_does_not_pass_preparation_or_retain_resources(self):
        self.text = lambda _threads: ''
        with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_SELF_TEST'):
            self.runtime.prepare(priority='background')
        self.assertEqual(len(self.live), 0)
        self.assertIsNone(self.runtime.lease.fd)

    def test_live_preemption_stops_before_allocating_another_candidate(self):
        self.text = lambda _threads: self.runtime.lease.request_live() or 'hello'
        with self.assertRaisesRegex(ValueError, 'LOCAL_ASR_PREEMPTED'):
            self.runtime.prepare(priority='background')
        self.assertEqual(self.loads, [1])
        self.assertEqual(len(self.live), 0)
        self.assertIsNone(self.runtime.lease.fd)
