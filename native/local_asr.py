"""Optional sherpa-onnx SenseVoice adapter. No downloader, microphone or model code."""
import base64
import io
from pathlib import Path
import re
import time
import wave


def pcm16(value):
    try:
        if not isinstance(value, str) or len(value) > 640100:
            raise ValueError()
        data = base64.b64decode(value, validate=True)
        with wave.open(io.BytesIO(data), 'rb') as wav:
            if (wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000
                    or wav.getcomptype() != 'NONE' or not 160 <= wav.getnframes() <= 240000):
                raise ValueError()
            frames = wav.readframes(wav.getnframes())
            if len(frames) != wav.getnframes() * 2:
                raise ValueError()
            return frames
    except Exception:
        raise ValueError('LOCAL_ASR_AUDIO') from None


def clean_transcript(text):
    return re.sub(r'<\|[^|]{0,40}\|>', '', str(text)).strip()[:1000]


def performance_phase(elapsed_ms, audio_ms):
    return 'ready' if elapsed_ms <= 2000 and 0 < elapsed_ms <= audio_ms * .6 else 'slow'


class LocalASR:
    def __init__(self, folder):
        self.folder = Path(folder) if folder else None
        self.recognizer = None
        self.status = {'phase': 'unprepared', 'model': 'SenseVoiceSmall-int8', 'device': 'cpu'}

    def decode(self, frames):
        import numpy as np
        samples = np.frombuffer(frames, dtype='<i2').astype(np.float32) / 32768
        if np.sqrt(np.mean(samples ** 2)) < .003:
            return ''
        stream = self.recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        self.recognizer.decode_stream(stream)
        return clean_transcript(stream.result.text)

    def prepare(self):
        import sherpa_onnx
        if not self.folder or not all((self.folder / name).is_file() for name in ['model.int8.onnx', 'tokens.txt', 'test_wavs/zh.wav']):
            raise ValueError('LOCAL_ASR_INSTALL')
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(self.folder / 'model.int8.onnx'), tokens=str(self.folder / 'tokens.txt'),
            num_threads=2, provider='cpu', language='zh', use_itn=True, debug=False)
        frames = pcm16(base64.b64encode((self.folder / 'test_wavs/zh.wav').read_bytes()).decode())
        self.decode(frames)  # Warm memory and kernels; no warmup output is evidence.
        started = time.perf_counter()
        self.decode(frames)
        elapsed = (time.perf_counter() - started) * 1000
        audio_ms = len(frames) / 32
        self.status = {**self.status, 'phase': performance_phase(elapsed, audio_ms),
                       'elapsedMs': round(elapsed), 'realTimeFactor': elapsed / audio_ms, 'threads': 2}
        return self.status

    def infer(self, data):
        if self.status['phase'] != 'ready':
            raise ValueError('LOCAL_ASR_NOT_READY')
        frames = pcm16(data)
        started = time.perf_counter()
        result = self.decode(frames)
        elapsed = (time.perf_counter() - started) * 1000
        if performance_phase(elapsed, len(frames) / 32) != 'ready':
            self.status['phase'] = 'slow'
            raise ValueError('LOCAL_ASR_SLOW')
        return result
