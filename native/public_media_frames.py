"""Bounded FFmpeg keyframes; timestamps come from decoded PTS, not seek guesses."""
from dataclasses import dataclass
import math
import re

from media_process import run_capture


MAX_FRAMES = 120


def frame_positions(duration_ms):
    if type(duration_ms) is not int or not 0 < duration_ms <= 10800000:
        raise ValueError('MEDIA_COVERAGE')
    last = max(0, duration_ms-1000)
    if not last:
        return [0]
    count = min(MAX_FRAMES, math.ceil(duration_ms/12000)+1)
    return [i*last//(count-1) for i in range(count)]


@dataclass(frozen=True)
class Keyframe:
    at_ms: int
    data: bytes


async def extract_keyframe(ffmpeg, path, position_ms):
    if type(position_ms) is not int or not 0 <= position_ms < 10800000:
        raise ValueError('MEDIA_VISUAL_FAILED')
    for size, quality in [(320, 8), (224, 12)]:
        args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'info', '-threads', '1',
                '-ss', str(position_ms/1000), '-copyts', '-start_at_zero', '-i', str(path),
                '-map', '0:v:0', '-an', '-vf',
                f"scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease,showinfo",
                '-frames:v', '1', '-threads', '1', '-q:v', str(quality), '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']
        try:
            data, stderr = await run_capture(args, timeout=30, maximum=36000)
            details = stderr.decode(errors='replace')
            timebase = re.search(r'config in time_base:\s*(\d+)/(\d+)', details)
            pts = re.search(r'\bn:\s*0\s+pts:\s*(-?\d+)\s+pts_time:', details)
            if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9') or not timebase or not pts:
                raise ValueError('MEDIA_VISUAL_FAILED')
            numerator, denominator = map(int, timebase.groups())
            at_ms = (int(pts[1])*numerator*1000+denominator//2)//denominator
            if at_ms < position_ms:
                raise ValueError('MEDIA_VISUAL_FAILED')
            return Keyframe(at_ms, data)
        except (ValueError, OSError, TimeoutError):
            pass
    raise ValueError('MEDIA_VISUAL_FAILED')
