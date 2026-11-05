import asyncio
import base64
import json
import struct
import unittest
from host import MediaPump
from protocol import Observer


class Cost(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, loud):
        now, sent, emitted = [10000], [], []
        observer = Observer('model', emitted.append, 120, 100000, clock=lambda: now[0])
        class Socket:
            async def send(self, raw):
                event = json.loads(raw)
                sent.append(event)
                if event['type'] == 'input_audio_buffer.commit':
                    observer.event({'type': 'input_audio_buffer.committed', 'item_id': str(len(sent))})
                    observer.responding = False
                    pump.awaiting_commit = False
        class Audio:
            async def readexactly(self, size):
                now[0] += 100
                pump.image = (b'jpeg', now[0])
                if now[0] > 70000:
                    raise asyncio.IncompleteReadError(b'', size)
                return struct.pack('<1600h', *([1000 if loud else 0] * 1600))
        pump = MediaPump(Socket(), observer, emitted.append, now=lambda: now[0])
        pump.ready = True
        pump.image = (b'jpeg', now[0])
        with self.assertRaisesRegex(ValueError, 'DECODE_FAILED'):
            await pump.audio(Audio())
        return sent, observer

    async def test_silence_does_not_stream_full_audio_or_purchase_every_eight_seconds(self):
        sent, observer = await self.exercise(False)
        self.assertLessEqual(len([e for e in sent if e['type'] == 'input_audio_buffer.append']), 6)
        self.assertLessEqual(len(observer.calls), 2)
        self.assertGreaterEqual(len(observer.calls), 1, 'silent visual changes still need periodic observations')

    async def test_speech_still_commits_every_eight_seconds_without_buying_omni_each_time(self):
        sent, observer = await self.exercise(True)
        self.assertGreaterEqual(len([e for e in sent if e['type'] == 'input_audio_buffer.commit']), 7)
        self.assertLessEqual(len(observer.calls), 2)
        self.assertGreaterEqual(sum(len(base64.b64decode(e['audio'])) for e in sent if e['type'] == 'input_audio_buffer.append'), 590 * 3200)

    def test_transcription_only_windows_keep_timestamps_without_consuming_visual_quota(self):
        emitted=[]
        observer=Observer('model', emitted.append, 1, 1000, clock=lambda: 10000)
        observer.begin(9000, 9800, respond=False)
        observer.event({'type':'input_audio_buffer.committed','item_id':'a'})
        observer.event({'type':'conversation.item.input_audio_transcription.completed','item_id':'a','transcript':'我小时候住在海边。'})
        self.assertEqual(observer.calls, [])
        self.assertFalse(observer.responding)
        self.assertEqual(emitted[0]['row']['text'], '我小时候住在海边。')
        self.assertEqual(emitted[0]['row']['at'], 9000)
