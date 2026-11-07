"""Local installation check. No live-room or paid API requests."""
import base64
import json
from pathlib import Path
import subprocess


def self_test(root=None):
    root = root or Path(__file__).resolve().parent
    runtime = json.loads((root / 'runtime.json').read_text())
    import streamget
    from websockets.asyncio.client import connect
    binary = runtime['ffmpeg']
    subprocess.run([binary, '-version'], check=True, capture_output=True, timeout=10)
    output = subprocess.run([binary, '-v', 'error', '-f', 'lavfi', '-i',
                             'sine=frequency=440:sample_rate=16000', '-t', '0.1',
                             '-ac', '1', '-f', 's16le', '-'], check=True, capture_output=True, timeout=10)
    if len(output.stdout) != 3200:
        raise ValueError('FFMPEG_CHECK_FAILED')
    result = {'ready': True, 'stream': 'StreamGet', 'ffmpeg': True}
    if runtime.get('asrModelDir'):
        from local_asr import LocalASR, pcm16
        recognizer = LocalASR(runtime['asrModelDir'])
        try:
            result['asr'] = dict(recognizer.prepare())
            sample = base64.b64encode((recognizer.folder / 'test_wavs/zh.wav').read_bytes()).decode()
            if not recognizer.decode(pcm16(sample)):
                raise ValueError('LOCAL_ASR_EMPTY')
        finally:
            recognizer.close()
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(self_test(), ensure_ascii=False))
    except Exception:
        print(json.dumps({'ready': False, 'error': 'LOCAL_SELF_TEST_FAILED'}))
        raise SystemExit(1)
