import base64
import io
import unittest
import wave
from local_asr import pcm16, clean_transcript, performance_phase, LocalASR

class LocalASRContracts(unittest.TestCase):
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
