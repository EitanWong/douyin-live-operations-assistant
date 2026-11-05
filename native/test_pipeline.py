"""Real local WebSocket + FFmpeg fixture test; never calls Alibaba or Douyin."""
import asyncio
import base64
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from host import configure, MediaPump, ffmpeg_args, terminate
from protocol import Observer


@unittest.skipUnless(importlib.util.find_spec('websockets') and shutil.which('ffmpeg'),
                     'Run with the installed native venv to verify real WebSocket + FFmpeg')
class Pipeline(unittest.IsolatedAsyncioTestCase):
    async def test_real_websocket_accepts_both_tracks_and_silent_scene_returns_observation(self):
        from websockets.asyncio.client import connect
        from websockets.asyncio.server import serve
        received, emitted = [], []
        async def server(ws):
            await ws.send(json.dumps({'type':'session.created'}))
            update = json.loads(await ws.recv())
            self.assertEqual(update['type'], 'session.update')
            await ws.send(json.dumps({'type':'session.updated','session':update['session']}))
            try:
                async for raw in ws:
                    event = json.loads(raw)
                    received.append(event)
                    if event['type'] == 'input_audio_buffer.append':
                        self.assertEqual(len(base64.b64decode(event['audio'])), 3200)
                    if event['type'] == 'input_image_buffer.append':
                        image = base64.b64decode(event['image'])
                        self.assertTrue(image.startswith(b'\xff\xd8') and image.endswith(b'\xff\xd9'))
                    if event['type'] == 'input_audio_buffer.commit':
                        await ws.send(json.dumps({'type':'input_audio_buffer.committed'}))
                        # A duplicated acknowledgement must not purchase a second turn.
                        await ws.send(json.dumps({'type':'input_audio_buffer.committed'}))
                    if event['type'] == 'response.create':
                        await ws.send(json.dumps({'type':'response.created','response':{'id':'r1'}}))
                        await ws.send(json.dumps({'type':'response.text.done','response_id':'r1','text':'画面有移动的测试图案。'}))
                        await ws.send(json.dumps({'type':'response.done','response':{'id':'r1','status':'completed','usage':{'total_tokens':20}}}))
            except Exception:
                pass
        binary = shutil.which('ffmpeg')
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'fixture.flv')
            subprocess.run([binary,'-y','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25',
                            '-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','20','-c:v','libx264',
                            '-preset','ultrafast','-g','25','-c:a','aac','-f','flv',path],check=True,capture_output=True)
            async with serve(server, '127.0.0.1', 0) as local:
                port = local.sockets[0].getsockname()[1]
                async with connect(f'ws://127.0.0.1:{port}', proxy=None) as ws:
                    await configure(ws, 'qwen3.8-omni-flash-realtime')
                    args = ffmpeg_args(binary, 'https://pull.douyincdn.com/live/fixture.flv')
                    for option in ['-user_agent','-referer','-tls_verify','-rw_timeout']:
                        i = args.index(option);del args[i:i+2]
                    args[args.index('-protocol_whitelist')+1] = 'file,crypto'
                    i = args.index('-i');args[i:i] = ['-re']
                    args[args.index('-i')+1] = path
                    process = await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
                    observer = Observer('model', emitted.append, 10, 10000)
                    pump = MediaPump(ws, observer, emitted.append)
                    task = asyncio.create_task(pump.run(process))
                    try:
                        async with asyncio.timeout(18):
                            while not any(e['type']=='observation' for e in emitted):
                                if task.done(): task.result()
                                await asyncio.sleep(0.05)
                    finally:
                        task.cancel();await asyncio.gather(task,return_exceptions=True);await terminate(process)
                    self.assertTrue(any(e['type']=='ready' for e in emitted))
                    self.assertLessEqual(len([e for e in received if e['type']=='input_audio_buffer.append']), 3)
                    self.assertEqual(len([e for e in received if e['type']=='input_image_buffer.append']), 2)
                    self.assertEqual(len([e for e in received if e['type']=='response.create']), 1)
                    self.assertIsNotNone(process.returncode)
