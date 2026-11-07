"""On-demand Chrome native host: StreamGet -> one FFmpeg -> Omni WebSocket.

Only native-framed, bounded status/observation messages go to stdout. Child
output and provider error text are never forwarded to the extension.
"""
import asyncio
import base64
import contextlib
from collections import deque
import json
from pathlib import Path
import shutil
import struct
import sys
import threading
import time
import uuid
from importlib.metadata import version

from protocol import read_message, write_message, parse_config, session_settings, Observer, INSTRUCTIONS
from resolver import media_url
from stream_source import StreamSource

ROOT = Path(__file__).resolve().parent
clock = lambda: int(time.time() * 1000)


def emit(value):
    write_message(value, sys.stdout.buffer)


async def terminate(process):
    if not process or process.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), 2)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


async def resolve_streams(room):
    process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT / 'resolver.py'), room,
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        async with asyncio.timeout(22):
            data = await process.stdout.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError('RESOLVE_FAILED')
            await process.wait()
        rows = json.loads(data).get('candidates', [])
        if process.returncode or not isinstance(rows, list) or not rows or len(rows) > 12:
            raise ValueError('RESOLVE_FAILED')
        if any(not isinstance(row, dict) or not media_url(row.get('url')) for row in rows):
            raise ValueError('RESOLVE_FAILED')
        return rows
    except (ValueError, asyncio.TimeoutError):
        raise ValueError('RESOLVE_FAILED') from None
    finally:
        await terminate(process)


def ffmpeg_args(binary, url):
    if not media_url(url):
        raise ValueError('DECODE_FAILED')
    # Two binary outputs: PCM on stdout, JPEG on stderr. quiet disables all
    # diagnostic writes to stderr, so no logs can corrupt the JPEG channel.
    return [binary, '-nostdin', '-hide_banner', '-loglevel', 'quiet', '-nostats',
            '-rw_timeout', '15000000', '-fflags', 'nobuffer', '-flags', 'low_delay',
            '-analyzeduration', '2000000', '-probesize', '2000000',
            '-user_agent', 'Mozilla/5.0', '-referer', 'https://live.douyin.com/',
            '-tls_verify', '1', '-protocol_whitelist', 'https,tls,tcp,crypto', '-i', url,
            '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
            '-map', '0:v:0', '-an', '-vf', 'fps=1,scale=640:480:force_original_aspect_ratio=decrease',
            '-c:v', 'mjpeg', '-threads', '1', '-q:v', '6', '-f', 'image2pipe', 'pipe:2']


class MediaPump:
    def __init__(self, ws, observer, send=emit, now=clock, visual_interval=None):
        self.ws, self.observer, self.emit, self.now = ws, observer, send, now
        self.image = None
        self.audio_sent = False
        self.ready = False
        self.started = self.window_at = self.now()
        self.committed_at = 0
        self.awaiting_commit = False
        self.request_visual = False
        self.visual_interval = visual_interval or max(12000, 3600000 / getattr(observer, 'max_calls', 120))
        self.last_visual = self.started - self.visual_interval + 8000
        self.audio_at = None
        self.speech_until = 0
        self.prefix = deque(maxlen=3)
        self.tasks = []

    async def send(self, value):
        value['event_id'] = uuid.uuid4().hex
        await asyncio.wait_for(self.ws.send(json.dumps(value, separators=(',', ':'))), 3)

    async def video(self, stream):
        pending = bytearray()
        while True:
            try:
                chunk = await asyncio.wait_for(stream.read(65536), 18)
            except TimeoutError:
                raise ValueError('DECODE_FAILED') from None
            if not chunk:
                raise ValueError('DECODE_FAILED')
            pending.extend(chunk)
            while True:
                start = pending.find(b'\xff\xd8')
                end = pending.find(b'\xff\xd9', max(0, start + 2))
                if start < 0 or end < 0:
                    break
                frame = bytes(pending[start:end + 2])
                del pending[:end + 2]
                if len(frame) > 190000:
                    raise ValueError('DECODE_FAILED')
                self.image = (frame, self.now())
            if len(pending) > 256000:
                raise ValueError('DECODE_FAILED')

    async def images(self):
        while True:
            await asyncio.sleep(0.1)
            if self.now() - self.started > 20000 and not self.ready:
                raise ValueError('DECODE_FAILED')
            if self.image and self.audio_sent and not self.ready:
                await self.send({'type': 'input_image_buffer.append', 'image': base64.b64encode(self.image[0]).decode()})
                if not self.ready:
                    self.ready = True
                    self.emit({'type': 'ready'})
                    self.emit({'type': 'state', 'phase': 'observing', 'totalTokens': self.observer.total_tokens})

    async def append_audio(self, chunk, at):
        if self.audio_at is None:
            self.audio_at = at
        await self.send({'type': 'input_audio_buffer.append', 'audio': base64.b64encode(chunk).decode()})
        self.audio_sent = True

    async def commit(self, now, visual):
        if visual:
            await self.send({'type': 'input_image_buffer.append', 'image': base64.b64encode(self.image[0]).decode()})
            self.last_visual = now
        self.observer.begin(self.audio_at, now, respond=visual)
        self.committed_at = now
        self.window_at = now
        self.audio_at = None
        self.awaiting_commit = True
        self.request_visual = visual
        await self.send({'type': 'input_audio_buffer.commit'})

    async def audio(self, stream):
        while True:
            try:
                chunk = await asyncio.wait_for(stream.readexactly(3200), 18)
            except (asyncio.IncompleteReadError, TimeoutError):
                raise ValueError('DECODE_FAILED') from None
            now = self.now()
            samples = struct.unpack('<1600h', chunk)
            audible = sum(value * value for value in samples) / len(samples) >= (32768 * 0.003) ** 2
            if audible:
                self.speech_until = now + 800
            if audible or now < self.speech_until or not self.audio_sent:
                for prefix, at in self.prefix:
                    await self.append_audio(prefix, at)
                self.prefix.clear()
                await self.append_audio(chunk, now - 100)
            else:
                self.prefix.append((chunk, now - 100))
            if self.ready and (not self.image or now - self.image[1] > 5000):
                raise ValueError('DECODE_FAILED')
            if (self.observer.responding or self.awaiting_commit) and now - self.committed_at > 25000:
                raise ValueError('MODEL_FAILED')
            visual = now - self.last_visual >= self.visual_interval
            segment = self.audio_at is not None and (now - self.audio_at >= 8000 or self.speech_until and now >= self.speech_until)
            if self.ready and not self.observer.responding and not self.awaiting_commit and (visual or segment):
                if self.audio_at is None:
                    await self.append_audio(chunk, now - 100)
                await self.commit(now, visual)

    async def receive(self):
        async for raw in self.ws:
            event = json.loads(raw)
            if event.get('type') == 'input_audio_buffer.committed':
                if not self.awaiting_commit:
                    continue
                self.observer.event(event)
                if self.request_visual:
                    await self.send({'type': 'response.create'})
                self.awaiting_commit = False
                continue
            self.observer.event(event)
        raise ValueError('MODEL_FAILED')

    async def run(self, process):
        self.tasks = [asyncio.create_task(fn) for fn in [self.video(process.stderr), self.audio(process.stdout), self.images(), self.receive()]]
        try:
            done, _ = await asyncio.wait(self.tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)


async def configure(ws, model):
    desired = session_settings(model)
    async with asyncio.timeout(20):
        while True:
            event = json.loads(await ws.recv())
            if event.get('type') == 'error':
                raise ValueError('MODEL_FAILED')
            if event.get('type') == 'session.created':
                await ws.send(json.dumps({'type': 'session.update', 'event_id': uuid.uuid4().hex, 'session': desired}))
            if event.get('type') == 'session.updated':
                session = event.get('session', {})
                # Alibaba omits nullable turn_detection in the acknowledgement.
                # The acknowledged update explicitly requested manual turns;
                # reject an explicit VAD override, allow an omitted/null field.
                if session.get('modalities') != ['text'] or session.get('turn_detection') is not None or session.get('instructions') != INSTRUCTIONS:
                    raise ValueError('MODEL_FAILED')
                return


async def attempt(config, observer, candidate, binary):
    from websockets.asyncio.client import connect
    emit({'type': 'state', 'phase': 'connecting'})
    async with connect(config['endpoint'], additional_headers={'Authorization': f"Bearer {config['key']}"},
                       open_timeout=15, close_timeout=2, max_size=1024 * 1024, max_queue=8, proxy=None) as ws:
        await configure(ws, config['model'])
        emit({'type': 'state', 'phase': 'decoding'})
        process = await asyncio.create_subprocess_exec(*ffmpeg_args(binary, candidate['url']),
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            await MediaPump(ws, observer, visual_interval=config['visual_interval']).run(process)
        finally:
            await terminate(process)


async def run_session(config, observer, binary):
    async with asyncio.timeout(config['minutes'] * 60):
        for generation in range(5):
            try:
                emit({'type': 'state', 'phase': 'resolving'})
                resolve = config.get('resolve', resolve_streams)
                rows = await resolve(config['room'])
                for candidate in rows:
                    observer.pending.clear()
                    observer.text.clear()
                    observer.responding = False
                    try:
                        await attempt(config, observer, candidate, binary)
                        return
                    except ValueError as error:
                        if str(error) != 'DECODE_FAILED':
                            raise
                raise ValueError('DECODE_FAILED')
            except asyncio.CancelledError:
                raise
            except Exception as error:
                code = str(error) if str(error) in ['RESOLVE_FAILED', 'DECODE_FAILED', 'MODEL_FAILED', 'LIMIT', 'SESSION_LIMIT'] else 'MODEL_FAILED'
                if code in ['LIMIT', 'SESSION_LIMIT', 'MODEL_FAILED'] or generation == 4:
                    raise ValueError(code) from None
                emit({'type': 'state', 'phase': 'recovering', 'totalTokens': observer.total_tokens})
                await asyncio.sleep(min(2 ** generation, 8))


async def session(message, resolve=None):
    try:
        config = parse_config(message)
        if resolve:
            config['resolve'] = resolve
        runtime = json.loads((ROOT / 'runtime.json').read_text()) if (ROOT / 'runtime.json').exists() else {}
        binary = runtime.get('ffmpeg') or shutil.which('ffmpeg')
        if not binary or not Path(binary).is_file():
            raise ValueError('DECODE_FAILED')
        calls = []
        while True:
            observer = Observer(config['model'], emit, config['calls'], config['tokens'])
            observer.calls = calls
            try:
                await run_session(config, observer, binary)
            except TimeoutError:
                pass
            except ValueError as error:
                if str(error) not in ['SESSION_LIMIT', 'LIMIT']:
                    raise
                if str(error) == 'LIMIT':
                    retry_at = min(observer.calls, default=clock()) + 3600000
                    emit({'type':'state', 'phase':'waiting', 'retryAt':retry_at})
                    await asyncio.sleep(max(0, retry_at - clock()) / 1000)
            calls = observer.calls
            emit({'type':'state', 'phase':'renewing', 'totalTokens':0})
            # A fresh provider session has no growing conversation history.
            # Observations already emitted remain in the room's memory writer.
            await asyncio.sleep(0)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        code = str(error) if str(error) in ['INVALID', 'RESOLVE_FAILED', 'DECODE_FAILED', 'MODEL_FAILED', 'LIMIT'] else 'MODEL_FAILED'
        emit({'type': 'error', 'code': code})


async def main():
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue(maxsize=8)
    def deliver(value):
        if queue.full():
            while not queue.empty():
                queue.get_nowait()
            value = None
        queue.put_nowait(value)
    def reader():
        try:
            while True:
                value = read_message(sys.stdin.buffer)
                loop.call_soon_threadsafe(deliver, value)
                if value is None:
                    return
        except Exception:
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(deliver, None)
    threading.Thread(target=reader, daemon=True).start()
    task = None
    streams = StreamSource(emit, resolve_streams)
    local = None
    local_task = None
    public_media = None
    async def local_request(message):
        nonlocal local
        try:
            if local is None:
                from local_asr import LocalASR
                runtime = json.loads((ROOT / 'runtime.json').read_text()) if (ROOT / 'runtime.json').exists() else {}
                local = LocalASR(runtime.get('asrModelDir'))
            action = message.get('action')
            if action == 'prepare':
                value = await asyncio.to_thread(local.prepare)
            elif action == 'infer':
                value = await asyncio.to_thread(local.infer, message.get('data'))
            elif action == 'status':
                value = local.status
            else:
                raise ValueError()
            emit({'id': message.get('id'), 'value': value})
        except Exception:
            emit({'id': message.get('id'), 'error': 'SenseVoice 本地识别不可用，请检查组件、模型安装及设备测速结果'})
    try:
        while True:
            message = await queue.get()
            if message is None or message.get('type') == 'stop':
                return
            if message.get('type') == 'public-media' and not task and local is None:
                if public_media is None:
                    from public_media_session import PublicMediaSession
                    public_media = PublicMediaSession(ROOT, emit)
                public_media.handle(message)
                continue
            if public_media is not None:
                emit({'type': 'error', 'code': 'INVALID'})
                return
            if message.get('type') == 'streams' and task:
                streams.receive(message)
                continue
            if message.get('type') == 'local-asr' and not task:
                if local_task and not local_task.done():
                    emit({'id': message.get('id'), 'error': '本地语音繁忙'})
                else:
                    local_task = asyncio.create_task(local_request(message))
                continue
            if message.get('type') == 'probe' and not task:
                try:
                    runtime = json.loads((ROOT / 'runtime.json').read_text()) if (ROOT / 'runtime.json').exists() else {}
                    binary = runtime.get('ffmpeg') or shutil.which('ffmpeg')
                    assert version('streamget') == '4.0.10' and version('websockets') == '17.4'
                    process = await asyncio.create_subprocess_exec(binary, '-version', stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                    try:
                        assert await asyncio.wait_for(process.wait(), 5) == 0
                    finally:
                        await terminate(process)
                    emit({'type': 'health', 'ready': True})
                except Exception:
                    emit({'type': 'error', 'code': 'NOT_INSTALLED'})
                return
            if message.get('type') != 'start' or task:
                emit({'type': 'error', 'code': 'INVALID'})
                return
            task = asyncio.create_task(session(message, streams.resolve))
    finally:
        if public_media:
            await public_media.close()
        if local_task:
            local_task.cancel()
            await asyncio.gather(local_task, return_exceptions=True)
        if local:
            await asyncio.to_thread(local.close)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except (BrokenPipeError, KeyboardInterrupt):
        pass
