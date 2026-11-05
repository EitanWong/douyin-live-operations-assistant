import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from stream_source import StreamSource
from host import run_session
from protocol import Observer


URL = 'https://pull.douyincdn.com/live/test.flv?sign=private'


class StreamSourceContracts(unittest.IsolatedAsyncioTestCase):
    async def test_logged_in_page_supplies_stream_without_exporting_cookies(self):
        events = []
        fallback = AsyncMock()
        source = StreamSource(events.append, fallback, timeout=.05)
        task = asyncio.create_task(source.resolve('123'))
        await asyncio.sleep(0)
        request = events[0]
        self.assertEqual(request['type'], 'stream-request')
        source.receive({'type': 'streams', 'id': request['id'], 'room': '123',
                        'candidates': [{'url': URL, 'format': 'flv'}]})
        self.assertEqual((await task)[0]['url'], URL)
        fallback.assert_not_awaited()
        self.assertEqual(source.pending, {})

    async def test_invalid_missing_or_stale_page_uses_independent_resolver(self):
        for rows, room in [([{'url': 'https://localhost/a.flv'}], '123'),
                           ([{'url': URL}], '999'), ([], '123')]:
            events = []
            fallback = AsyncMock(return_value=[{'url': URL}])
            source = StreamSource(events.append, fallback, timeout=.001)
            task = asyncio.create_task(source.resolve('123'))
            await asyncio.sleep(0)
            source.receive({'id': events[0]['id'], 'room': room, 'candidates': rows})
            self.assertEqual((await task)[0]['url'], URL)
            fallback.assert_awaited_once_with('123')
            self.assertEqual(source.pending, {})

    async def test_cancelled_resolution_cannot_be_revived_by_late_page_result(self):
        events = []
        source = StreamSource(events.append, AsyncMock(), timeout=1)
        task = asyncio.create_task(source.resolve('123'))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        source.receive({'id': events[0]['id'], 'room': '123', 'candidates': [{'url': URL}]})
        self.assertEqual(source.pending, {})
        source.fallback.assert_not_awaited()

    async def test_decoder_tries_all_fresh_candidates_before_resolving_again(self):
        rows = [{'url': URL}, {'url': URL.replace('test.flv', 'backup.m3u8')}]
        resolver = AsyncMock(return_value=rows)
        attempted = []

        async def attempt(config, observer, candidate, binary):
            attempted.append(candidate['url'])
            if len(attempted) == 1:
                raise ValueError('DECODE_FAILED')
            raise asyncio.CancelledError()

        with patch('host.resolve_streams', resolver), patch('host.attempt', attempt), patch('host.emit'):
            with self.assertRaises(asyncio.CancelledError):
                await run_session({'room': '123', 'minutes': 1}, Observer('model', lambda e: None, 10, 1000), 'ffmpeg')
        self.assertEqual(attempted, [row['url'] for row in rows])
        resolver.assert_awaited_once()
