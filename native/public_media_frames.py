"""Bounded FFmpeg keyframes; timestamps come from decoded PTS, not seek guesses."""
from dataclasses import dataclass
from fractions import Fraction
import math
import re

from media_process import run_capture


MAX_FRAMES = 120


async def read_video_duration(stream):
    # Fold FFmpeg's packet timeline in constant space, including the last
    # packet's display duration. DTS and progress time can exclude that tail.
    timebase = None
    end = 0
    while line := await stream.readline():
        if len(line) > 4096:
            raise ValueError('MEDIA_DECODE_FAILED')
        if line.startswith(b'#tb 0: '):
            timebase = Fraction(line[7:].decode('ascii').strip())
            if timebase <= 0:
                raise ValueError('MEDIA_DECODE_FAILED')
        elif not line.startswith(b'#'):
            fields = line.split(b',')
            if timebase is None or len(fields) < 6 or int(fields[0]) != 0 or int(fields[3]) <= 0:
                raise ValueError('MEDIA_DECODE_FAILED')
            end = max(end, (int(fields[2])+int(fields[3]))*timebase)
            if end > 10800:
                raise ValueError('MEDIA_DECODE_FAILED')
    duration_ms = math.ceil(end*1000)
    frame_positions(duration_ms)
    return duration_ms


async def decode_video_duration(ffmpeg, path):
    args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-xerror',
            '-protocol_whitelist', 'file,pipe', '-i', str(path), '-map', '0:v:0', '-an',
            '-fps_mode', 'passthrough', '-f', 'null', '-',
            '-map', '0:v:0', '-c:v', 'copy', '-f', 'framecrc', 'pipe:1']
    try:
        # The null output still decodes every frame with -xerror; the parallel
        # stream-copy output retains original PTS/duration, including VFR/B frames.
        duration_ms, _ = await run_capture(args, stdout_reader=read_video_duration)
        return duration_ms
    except (ValueError, ZeroDivisionError, OSError, TimeoutError):
        raise ValueError('MEDIA_DECODE_FAILED') from None


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
