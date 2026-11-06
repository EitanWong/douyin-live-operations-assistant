"""Optional sherpa-onnx SenseVoice adapter. No downloader, microphone or model code."""
import base64
import io
import importlib.util
import os
from pathlib import Path
import re
import time
import statistics
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
    # A short VAD utterance still pays fixed encoder/decoder overhead. Keep
    # the latency ceiling and headroom without rejecting every short word.
    return 'ready' if 0 < audio_ms and 0 < elapsed_ms <= min(2000, max(1000, audio_ms) * .6) else 'slow'


def trim_silence(frames):
    import numpy as np
    samples = np.frombuffer(frames, dtype='<i2')
    complete = len(samples) // 160
    if not complete:
        return frames
    blocks = samples[:complete * 160].astype(np.float32).reshape(-1, 160) / 32768
    active = np.flatnonzero(np.sqrt(np.mean(blocks ** 2, axis=1)) >= .003)
    if not len(active):
        return b''
    start = max(0, (int(active[0]) - 12) * 160)
    end = min(len(samples), (int(active[-1]) + 13) * 160)
    return frames[start * 2:end * 2]


def benchmark_frames(frames):
    import numpy as np
    # Match live four-second chunks, selecting real speech rather than timing
    # silence or a much longer bundled recording against a two-second limit.
    frames = trim_silence(frames)
    size = 4 * 16000 * 2
    if len(frames) <= size:
        return frames
    chunks = [frames[start:start + size] for start in range(0, len(frames) - size + 1, 16000 * 2)]
    return max(chunks, key=lambda chunk: float(np.mean(np.frombuffer(chunk, dtype='<i2').astype(np.float32) ** 2)))


class LocalASR:
    def __init__(self, folder):
        self.folder = Path(folder) if folder else None
        self.recognizer = None
        available = bool(self.folder and all((self.folder / name).is_file() for name in ['model.int8.onnx', 'tokens.txt', 'test_wavs/zh.wav'])
                         and importlib.util.find_spec('sherpa_onnx') and importlib.util.find_spec('numpy'))
        self.status = {'phase': 'unprepared', 'available': available, 'model': 'SenseVoiceSmall-int8', 'device': 'cpu'}

    def decode(self, frames):
        import numpy as np
        frames = trim_silence(frames)
        if not frames:
            return ''
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
        frames = benchmark_frames(pcm16(base64.b64encode((self.folder / 'test_wavs/zh.wav').read_bytes()).decode()))
        if not frames:
            raise ValueError('LOCAL_ASR_SELF_TEST')
        audio_ms = len(frames) / 32
        candidates = [n for n in [1, 2, 4] if n <= max(1, (os.cpu_count() or 2) - 1)]
        best = None
        benchmarks = []
        for threads in candidates:
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(self.folder / 'model.int8.onnx'), tokens=str(self.folder / 'tokens.txt'),
                num_threads=threads, provider='cpu', language='zh', use_itn=True, debug=False)
            if not self.decode(frames):
                raise ValueError('LOCAL_ASR_SELF_TEST')
            timings = []
            for _ in range(3):
                started = time.perf_counter()
                if not self.decode(frames):
                    raise ValueError('LOCAL_ASR_SELF_TEST')
                timings.append((time.perf_counter() - started) * 1000)
            elapsed = statistics.median(timings)
            benchmarks.append({'threads': threads, 'medianMs': round(elapsed), 'maxMs': round(max(timings))})
            if best is None or elapsed < best[0]:
                best = (elapsed, threads, self.recognizer)
        elapsed, threads, self.recognizer = best
        self.status = {**self.status, 'phase': performance_phase(elapsed, audio_ms),
                       'elapsedMs': round(elapsed), 'realTimeFactor': elapsed / audio_ms, 'threads': threads,
                       'sampleMs': audio_ms, 'benchmarks': benchmarks, 'selfTestPassed': True, 'consecutiveOverruns': 0}
        return self.status

    def infer(self, data):
        if self.status['phase'] != 'ready':
            raise ValueError('LOCAL_ASR_NOT_READY')
        frames = pcm16(data)
        started = time.perf_counter()
        result = self.decode(frames)
        elapsed = (time.perf_counter() - started) * 1000
        overrun = performance_phase(elapsed, len(frames) / 32) != 'ready'
        self.status.update({'lastInferenceMs': round(elapsed), 'consecutiveOverruns': self.status.get('consecutiveOverruns', 0) + 1 if overrun else 0})
        if self.status['consecutiveOverruns'] >= 3:
            self.status['phase'] = 'slow'
            raise ValueError('LOCAL_ASR_SLOW')
        return result
