import asyncio
import io
import json
import struct
import base64
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from resolver import candidates, canonical_room, room_payload
from protocol import read_message, write_message, session_settings, parse_config, Observer
from host import configure, MediaPump, ffmpeg_args, terminate


class Contracts(unittest.TestCase):
    def test_framing_and_boundary(self):
        out = io.BytesIO()
        write_message({'type': 'ready'}, out)
        self.assertEqual(read_message(io.BytesIO(out.getvalue())), {'type': 'ready'})
        with self.assertRaises(ValueError):
            read_message(io.BytesIO(struct.pack('<I', 2_000_000)))
        with self.assertRaises(ValueError):
            read_message(io.BytesIO(struct.pack('<I', 10) + b'{}'))

    def test_candidates_are_bound_to_room_and_not_status_head_boolean(self):
        self.assertEqual(canonical_room('123456'), 'https://live.douyin.com/123456')
        with self.assertRaises(ValueError): canonical_room('123/../4')
        room = {'status': 2, 'stream_url': {'flv_pull_url': {
            'SD': 'https://pull.douyincdn.com/live/a.flv?sign=keep',
            'ORIGIN': 'https://pull.douyincdn.com/live/b.flv?sign=keep',
            'BAD': 'https://localhost:443/live/a.flv',
        }, 'hls_pull_url_map': {'SD': 'https://pull.douyincdn.com/live/a.m3u8'}}}
        rows = candidates(room)
        self.assertEqual(rows[0]['quality'], 'SD')
        self.assertEqual(rows[0]['format'], 'flv')
        self.assertEqual(len(rows), 3)
        self.assertIn('sign=keep', rows[0]['url'])
        with self.assertRaises(ValueError): candidates({**room, 'status': 4})

    def test_raw_web_response_accepts_single_transport_without_origin_and_rejects_wrong_room(self):
        payload = {'status_code':0,'data':{'data':[{'status':2,'web_rid':'123456','stream_url':{'flv_pull_url':{'SD':'https://pull.douyincdn.com/live/only.flv'}}}]}}
        rows = candidates(room_payload(payload, '123456'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['format'], 'flv')
        with self.assertRaises(ValueError): room_payload(payload, '999999')
        with self.assertRaises(ValueError): room_payload({'status_code':1,'data':payload['data']}, '123456')

    def test_model_endpoint_and_session(self):
        config = parse_config({'room': '123456', 'key': 'secret', 'config': {
            'realtimeEndpoint': 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',
            'realtimeModel': 'qwen3.8-omni-flash-realtime', 'sessionMinutes': 1, 'sessionTokens': 1000, 'maxPerHour': 10}})
        self.assertTrue(config['endpoint'].startswith('wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model='))
        session = session_settings(config['model'])
        self.assertEqual(session['modalities'], ['text'])
        self.assertIsNone(session['turn_detection'])
        self.assertEqual(session['audio']['input']['format']['sample_rate'], 16000)
        with self.assertRaises(ValueError): parse_config({'room': '123456','key': 'secret','config': {'realtimeEndpoint': 'https://evil.example'}})

    def test_observations_only_final_deduplicated_and_budgeted(self):
        emitted = []
        observer = Observer('model', emitted.append, max_calls=2, max_tokens=1000, clock=lambda: 10000)
        observer.begin(9000, 9800)
        observer.event({'type':'response.created','response':{'id':'r1'}})
        self.assertEqual(emitted, [])
        event = {'type':'response.done','response':{'id':'r1','status':'completed','output':[{'type':'message','content':[{'type':'text','text':'主播拿起杯子'}]}],'usage':{'total_tokens':10}}}
        observer.event(event);observer.event(event)
        self.assertEqual(len([e for e in emitted if e['type']=='observation']),1)
        self.assertEqual(emitted[0]['row']['at'],9000)
        observer.begin(9900,10000)
        observer.event({'type':'response.created','response':{'id':'r2'}})
        with self.assertRaises(ValueError):
            observer.event({'type':'response.done','response':{'id':'r2','status':'completed','usage':{'total_tokens':1000}}})

    def test_text_done_waits_for_completed_response(self):
        emitted = []
        observer = Observer('model', emitted.append, 2, 1000, clock=lambda: 10000)
        observer.begin(9000, 9800)
        observer.event({'type':'response.created','response':{'id':'r'}})
        observer.event({'type':'response.text.done','response_id':'r','text':'主播在展示商品。'})
        self.assertEqual(emitted, [])
        observer.event({'type':'response.done','response':{'id':'r','status':'completed','usage':{'total_tokens':5}}})
        self.assertEqual(emitted[0]['row']['text'], '主播在展示商品。')


class Runtime(unittest.IsolatedAsyncioTestCase):
    async def test_confirmation_gate(self):
        class Socket:
            def __init__(self, reject=False):
                self.sent = []
                self.events = [{'type': 'session.created'}, {'type': 'session.updated', 'session': session_settings('qwen3.8-omni-flash-realtime')}]
                if reject: self.events[1]['session']['modalities'] = ['text', 'audio']
            async def recv(self): return json.dumps(self.events.pop(0))
            async def send(self, raw): self.sent.append(json.loads(raw))
        ws = Socket()
        await configure(ws, 'qwen3.8-omni-flash-realtime')
        self.assertEqual([e['type'] for e in ws.sent], ['session.update'])
        with self.assertRaises(ValueError): await configure(Socket(True), 'qwen3.8-omni-flash-realtime')

    async def test_continuous_silent_audio_commits_visual_turn_and_bounded_send(self):
        now, sent, emitted = [10000], [], []
        observer = Observer('model', emitted.append, 10, 1000, clock=lambda: now[0])
        pump = None
        class Socket:
            async def send(self, raw):
                event = json.loads(raw)
                sent.append(event)
                if event['type'] == 'input_audio_buffer.append':
                    self_test.assertEqual(base64.b64decode(event['audio']), bytes(3200))
                    now[0] += 100
                    pump.image = (b'jpeg', now[0])
                if event['type'] == 'input_audio_buffer.commit':
                    observer.event({'type':'response.created','response':{'id':'r'}})
                    observer.event({'type':'response.done','response':{'id':'r','status':'completed','output':[{'type':'message','content':[{'type':'text','text':'主播挥手。'}]}],'usage':{'total_tokens':12}}})
        self_test = self
        class Audio:
            def __init__(self): self.chunks = 0
            async def readexactly(self, size):
                self.chunks += 1
                if self.chunks > 85: raise asyncio.IncompleteReadError(b'', size)
                return bytes(size)
        pump = MediaPump(Socket(), observer, emitted.append, now=lambda: now[0])
        pump.ready = True
        pump.image = (b'jpeg', now[0])
        with self.assertRaisesRegex(ValueError, 'DECODE_FAILED'): await pump.audio(Audio())
        self.assertEqual(len([e for e in sent if e['type'] == 'input_audio_buffer.append']), 85)
        self.assertEqual(len([e for e in sent if e['type'] == 'input_audio_buffer.commit']), 1)
        self.assertEqual(emitted[0]['row']['text'], '主播挥手。')
        self.assertEqual(emitted[0]['row']['at'], 10000)

    async def test_corrupt_or_missing_video_never_becomes_ready(self):
        emitted = []
        pump = MediaPump(None, None, emitted.append)
        stream = asyncio.StreamReader()
        stream.feed_data(bytes(300000))
        stream.feed_eof()
        with self.assertRaisesRegex(ValueError, 'DECODE_FAILED'): await pump.video(stream)
        self.assertFalse(pump.ready)
        self.assertEqual(emitted, [])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg unavailable: real decoder check not executed')
    async def test_real_single_ffmpeg_demuxes_audio_and_video_and_terminates(self):
        binary = shutil.which('ffmpeg')
        with tempfile.TemporaryDirectory() as folder:
            fixture = str(Path(folder) / 'sample.flv')
            subprocess.run([binary, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10',
                            '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-f', 'flv', fixture], check=True, capture_output=True)
            args = ffmpeg_args(binary, 'https://pull.douyincdn.com/live/test.flv')
            # Fixture-only transport substitution, not a production URL override.
            args[args.index('-protocol_whitelist') + 1] = 'file,crypto'
            args[args.index('-i') + 1] = fixture
            for option in ['-user_agent', '-referer', '-tls_verify', '-rw_timeout']:
                index = args.index(option)
                del args[index:index + 2]
            process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            audio, video = await asyncio.wait_for(process.communicate(), 20)
            self.assertEqual(process.returncode, 0)
            self.assertGreater(len(audio), 32000)
            self.assertTrue(any(audio))
            self.assertGreater(video.count(b'\xff\xd8'), 2)
            self.assertEqual(video.count(b'\xff\xd8'), video.count(b'\xff\xd9'))
            # Actual cancellation reaps the child instead of leaving a decoder.
            running = await asyncio.create_subprocess_exec(binary, '-loglevel', 'quiet', '-re', '-stream_loop', '-1', '-i', fixture, '-f', 'null', '-', stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await terminate(running)
            self.assertIsNotNone(running.returncode)


if __name__ == '__main__':
    unittest.main()
