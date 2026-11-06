"""Restartable public-video audio worker. Uses yt-dlp, FFmpeg and shared LocalASR.

Only short database operations hold the archive location lock. Downloaded media
is temporary; transcripts retain their source job, content hash and time range.
"""
import argparse
import asyncio
import base64
from dataclasses import dataclass
import hashlib
import io
import json
import math
import os
from pathlib import Path
import signal
import sys
import tempfile
import uuid
import wave

from data_location import DataLocation
from local_asr import LocalASR
from public_media_jobs import MAX_DURATION_MS, PublicMediaJobs


@dataclass(frozen=True)
class DownloadedMedia:
    path: Path
    duration_ms: int


async def reap(process):
    def signal_group(value):
        try:
            os.killpg(process.pid, value)
        except ProcessLookupError:
            pass
    async def drain(stream):
        while await stream.read(65536):
            pass
    # Readers must be joined before this function. Drain even when the child
    # already exited: unread pipes otherwise retain transports after loop close.
    signal_group(signal.SIGTERM)
    tasks = [asyncio.create_task(drain(stream)) for stream in (process.stdout, process.stderr)]
    tasks.append(asyncio.create_task(process.wait()))
    _, pending = await asyncio.wait(tasks, timeout=2)
    if pending:
        signal_group(signal.SIGKILL)
    await asyncio.gather(*tasks)


async def bounded_read(stream, maximum):
    result = bytearray()
    while True:
        block = await stream.read(min(65536, maximum+1-len(result)))
        if not block:
            return bytes(result)
        result.extend(block)
        if len(result) > maximum:
            raise ValueError('MEDIA_DOWNLOAD_FAILED')


async def run_bounded(args, timeout=180, maximum=2*1024*1024):
    process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
                                                  stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                  start_new_session=True)
    tasks = [asyncio.create_task(bounded_read(process.stdout, maximum)),
             asyncio.create_task(bounded_read(process.stderr, 131072))]
    try:
        async with asyncio.timeout(timeout):
            stdout, _ = await asyncio.gather(*tasks)
            if await process.wait() != 0:
                raise ValueError('MEDIA_DOWNLOAD_FAILED')
            return stdout
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await reap(process)


def verify_metadata(value, job):
    subject = job['subject']
    if (not isinstance(value, dict) or value.get('id') != job['workId']
            or value.get('channel_id') != job['author'] or value.get('extractor_key') != 'Douyin'
            or value.get('_type', 'video') != 'video'
            or subject.startswith('uid:') and value.get('uploader_id') != subject[4:]
            or subject.startswith('sec:') and value.get('channel_id') != subject[4:]):
        raise ValueError('MEDIA_AUTHOR_MISMATCH')
    duration = value.get('duration')
    if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration*1000 <= MAX_DURATION_MS:
        raise ValueError('MEDIA_DOWNLOAD_FAILED')
    return math.ceil(duration*1000)


async def download_public_video(job, folder):
    common = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-playlist',
              '--no-cache-dir', '--socket-timeout', '15', '--retries', '1', '--fragment-retries', '1',
              '--extractor-retries', '1', '--no-progress', '--quiet']
    metadata = json.loads(await run_bounded([*common, '--skip-download', '--dump-single-json', '--', job['url']]))
    verify_metadata(metadata, job)
    await run_bounded([*common, '--max-filesize', '256M', '--write-info-json', '--no-write-playlist-metafiles',
                       '-f', 'best[ext=mp4]/best', '-o', str(folder/'media.%(ext)s'), '--', job['url']])
    info = folder/'media.info.json'
    if not info.is_file() or info.stat().st_size > 2*1024*1024:
        raise ValueError('MEDIA_DOWNLOAD_FAILED')
    duration_ms = verify_metadata(json.loads(info.read_text()), job)
    files = [p for p in folder.iterdir() if p.name.startswith('media.') and p.suffix in ('.mp4', '.webm', '.mkv', '.flv')]
    if len(files) != 1 or not 0 < files[0].stat().st_size <= 256*1024*1024:
        raise ValueError('MEDIA_DOWNLOAD_FAILED')
    return DownloadedMedia(files[0], duration_ms)


def content_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def wav_payload(frames):
    result = io.BytesIO()
    with wave.open(result, 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(frames)
    return base64.b64encode(result.getvalue()).decode('ascii')


async def finish_thread(function, *args, **kwargs):
    # Python cannot cancel inference in a thread. Join it before unloading the
    # recognizer, deleting media or releasing its OS lease.
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


class PublicMediaWorker:
    def __init__(self, location, asr, ffmpeg, download=download_public_video, heartbeat_seconds=1):
        self.location, self.asr, self.ffmpeg = location, asr, ffmpeg
        self.download, self.heartbeat_seconds = download, heartbeat_seconds
        self.worker = 'media-'+uuid.uuid4().hex

    def call(self, method, *args, **kwargs):
        with self.location.open() as store:
            return getattr(PublicMediaJobs(store.db), method)(*args, **kwargs)

    async def db(self, method, *args, **kwargs):
        return await finish_thread(self.call, method, *args, **kwargs)

    async def heartbeat(self, job):
        renewed = asyncio.get_running_loop().time()
        while True:
            self.asr.check_priority()
            await asyncio.sleep(self.heartbeat_seconds)
            await self.db('fenced', job['id'], job['lease'])
            if asyncio.get_running_loop().time()-renewed >= 10:
                await self.db('renew', job['id'], job['lease'])
                renewed = asyncio.get_running_loop().time()

    async def run_once(self):
        job = await self.db('claim', self.worker)
        if job is None:
            return None
        operation = asyncio.create_task(self.process(job))
        heartbeat = asyncio.create_task(self.heartbeat(job))
        try:
            done, _ = await asyncio.wait([operation, heartbeat], return_when=asyncio.FIRST_COMPLETED)
            if heartbeat in done:
                await heartbeat
            else:
                await operation
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = str(error)
            try:
                if code in ('ASR_BUSY', 'LOCAL_ASR_PREEMPTED'):
                    await self.db('pause', job['id'], job['lease'], 'live-asr', delay_ms=30000)
                elif code in ('LOCAL_ASR_INSTALL', 'LOCAL_ASR_SLOW', 'LOCAL_ASR_NOT_READY') or isinstance(error, ModuleNotFoundError):
                    await self.db('pause', job['id'], job['lease'], 'model-unprepared', delay_ms=60000)
                else:
                    await self.db('fail', job['id'], job['lease'], code if code in ('MEDIA_AUTHOR_MISMATCH', 'MEDIA_DOWNLOAD_FAILED', 'MEDIA_DECODE_FAILED') else 'MEDIA_ANALYSIS_FAILED')
            except ValueError as fence:
                if str(fence) not in ('MEDIA_LEASE', 'MEDIA_EPOCH'):
                    raise
        finally:
            operation.cancel()
            heartbeat.cancel()
            await asyncio.gather(operation, heartbeat, return_exceptions=True)
            await finish_thread(self.asr.close)
        return await self.db('get', job['id'])

    async def process(self, job):
        # Check the shared resource before spending network or disk work.
        status = await finish_thread(self.asr.prepare, priority='background')
        if status['phase'] != 'ready':
            raise ValueError('LOCAL_ASR_NOT_READY')
        with tempfile.TemporaryDirectory(prefix='douyin-public-media-') as temporary:
            downloaded = await self.download(job, Path(temporary))
            path = downloaded.path
            job = await self.db('bind_media', job['id'], job['lease'], await finish_thread(content_hash, path))
            duration = await self.transcribe(job, path)
            if abs(duration-downloaded.duration_ms) > min(1000, max(250, downloaded.duration_ms*.02)):
                raise ValueError('MEDIA_DECODE_FAILED')
            await self.db('complete', job['id'], job['lease'], duration_ms=duration)

    async def transcribe(self, job, path):
        args = [self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1',
                '-protocol_whitelist', 'file,pipe', '-i', str(path), '-map', '0:a:0', '-vn',
                '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-f', 's16le', 'pipe:1']
        process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
                                                      stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                      start_new_session=True)
        stderr = asyncio.create_task(bounded_read(process.stderr, 131072))
        samples = 0
        try:
            while True:
                try:
                    frames = await asyncio.wait_for(process.stdout.readexactly(128000), 30)
                except asyncio.IncompleteReadError as end:
                    frames = end.partial
                if not frames:
                    break
                if len(frames) % 2:
                    raise ValueError('MEDIA_DECODE_FAILED')
                start = math.ceil(samples/16)
                samples += len(frames)//2
                end = math.ceil(samples/16)
                if end > MAX_DURATION_MS:
                    raise ValueError('MEDIA_DECODE_FAILED')
                if end > job['cursorMs']:
                    if start < job['cursorMs']:
                        raise ValueError('MEDIA_DECODE_FAILED')
                    # Short tail below the ASR's 10ms minimum is valid coverage.
                    text = await finish_thread(self.asr.infer, wav_payload(frames)) if len(frames) >= 320 else ''
                    segment = {'kind': 'transcript', 'startMs': start, 'endMs': end, 'text': text, 'speaker': 'unknown'}
                    await self.db('checkpoint', job['id'], job['lease'], [segment], cursor_ms=end)
            await asyncio.wait_for(stderr, 5)
            if await asyncio.wait_for(process.wait(), 5) != 0 or not samples:
                raise ValueError('MEDIA_DECODE_FAILED')
            return math.ceil(samples/16)
        except (asyncio.TimeoutError, OSError, asyncio.IncompleteReadError):
            raise ValueError('MEDIA_DECODE_FAILED') from None
        finally:
            stderr.cancel()
            await asyncio.gather(stderr, return_exceptions=True)
            await reap(process)


async def main():
    parser = argparse.ArgumentParser(description='公开视频可恢复音轨分析任务（本地运行时）')
    parser.add_argument('--database')
    parser.add_argument('--settings')
    parser.add_argument('--runtime', default=str(Path(__file__).with_name('runtime.json')))
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    runtime = json.loads(Path(args.runtime).read_text())
    worker = PublicMediaWorker(DataLocation(settings=args.settings, database=args.database),
                               LocalASR(runtime.get('asrModelDir')), runtime['ffmpeg'])
    while True:
        result = await worker.run_once()
        if result is not None:
            print(json.dumps(result, ensure_ascii=False), flush=True)
        if args.once:
            return
        if result is None:
            await asyncio.sleep(10)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
