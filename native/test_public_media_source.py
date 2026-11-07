import asyncio
from pathlib import Path
import tempfile
import unittest

from public_media_source import validate_media_source, download_page_media


NOW=1800000000000
JOB={'workId':'70','author':'author-sec','subject':'uid:2'}
SOURCE={'workId':'70','author':'author-sec','authorUid':'2','url':'https://v1.example.douyinvod.com/video/file.mp4?__vid=70',
        'durationMs':8400,'observedAt':NOW,'expiresAt':NOW+300000}


class PublicMediaSourceBoundary(unittest.TestCase):
    def test_only_fresh_same_work_and_stable_author_on_public_media_cdn_is_accepted(self):
        self.assertEqual(validate_media_source(SOURCE,JOB,NOW),SOURCE)
        for change in [{'workId':'71'},{'author':'other-sec'},{'authorUid':'3'},{'durationMs':0},
                       {'expiresAt':NOW+300001},{'observedAt':NOW+1},{'url':'https://localhost/file?__vid=70'},
                       {'url':'https://v1.douyinvod.com.attacker.test/file?__vid=70'},
                       {'url':'https://user:password@v1.douyinvod.com/file?__vid=70'},
                       {'url':'https://v1.douyinvod.com:444/file?__vid=70'},
                       {'url':'https://v1.douyinvod.com/file?__vid=71'},
                       {'url':'https://v1.douyinvod.com/file?__vid=70&__vid='},
                       {'url':'https://v1.douyinvod.com/file?__vid=70&__vid=71'}]:
            with self.subTest(change=change),self.assertRaisesRegex(ValueError,'MEDIA_SOURCE'):
                validate_media_source({**SOURCE,**change},JOB,NOW)
        with self.assertRaisesRegex(ValueError,'MEDIA_SOURCE'):
            validate_media_source(SOURCE,JOB,NOW+300000)
        with self.assertRaisesRegex(ValueError,'MEDIA_SOURCE'):
            validate_media_source(SOURCE,{**JOB,'epoch':NOW+1},NOW+2)


class PublicMediaSourceDownload(unittest.IsolatedAsyncioTestCase):
    async def test_streams_bounded_file_without_cookies_or_redirects_and_rejects_redirects_and_truncation(self):
        import httpx
        calls=[]
        async def handler(request):
            calls.append(request)
            return httpx.Response(200,headers={'Content-Type':'video/mp4','Content-Length':'8'},content=b'12345678')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            result=await download_page_media(SOURCE,root,transport=httpx.MockTransport(handler))
            self.assertEqual(result.path.read_bytes(),b'12345678')
            self.assertEqual(result.duration_ms,8400)
            self.assertNotIn('cookie',calls[0].headers)
            self.assertEqual(calls[0].headers['referer'],'https://www.douyin.com/')
            for response in [httpx.Response(302,headers={'Location':'http://127.0.0.1/private'}),
                             httpx.Response(200,headers={'Content-Type':'text/html'},content=b'challenge'),
                             httpx.Response(200,headers={'Content-Type':'video/mp4','Content-Length':'300000000'},content=b'x'),
                             httpx.Response(200,headers={'Content-Type':'video/mp4','Content-Length':'8'},content=b'tiny')]:
                seen=[]
                async def fail(request):seen.append(request);return response
                with self.assertRaisesRegex(ValueError,'MEDIA_DOWNLOAD_FAILED'):
                    await download_page_media(SOURCE,root,transport=httpx.MockTransport(fail))
                self.assertFalse((root/'page-media.mp4').exists())
                self.assertEqual(len(seen),1,'redirects must never be requested')

    async def test_cancellation_closes_stream_and_removes_partial_file(self):
        import httpx
        started=asyncio.Event();closed=asyncio.Event()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'first'
                started.set();await asyncio.Future()
            async def aclose(self):closed.set()
        async def handler(_request):return httpx.Response(200,headers={'Content-Type':'video/mp4'},stream=Stream())
        with tempfile.TemporaryDirectory() as folder:
            task=asyncio.create_task(download_page_media(SOURCE,Path(folder),transport=httpx.MockTransport(handler)))
            await asyncio.wait_for(started.wait(),1);task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertTrue(closed.is_set());self.assertEqual(list(Path(folder).iterdir()),[])

    async def test_chunked_response_cannot_exceed_byte_budget(self):
        import httpx
        from unittest.mock import patch
        async def handler(_request):return httpx.Response(200,headers={'Content-Type':'video/mp4'},content=b'x'*65)
        with tempfile.TemporaryDirectory() as folder,patch('public_media_source.MAX_MEDIA_BYTES',64):
            with self.assertRaisesRegex(ValueError,'MEDIA_DOWNLOAD_FAILED'):
                await download_page_media(SOURCE,Path(folder),transport=httpx.MockTransport(handler))
            self.assertEqual(list(Path(folder).iterdir()),[])
