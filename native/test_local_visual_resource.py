import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx

from model_lease import ModelLease
from local_visual_resource import LocalVisualResource


class LocalVisualResourceContracts(unittest.IsolatedAsyncioTestCase):
    async def test_native_inference_uses_supported_api_without_browser_owned_model_requests(self):
        requests=[]
        def respond(request):
            if request.url.path=='/api/version':return httpx.Response(200,json={'version':'0.24.0'})
            requests.append((request.url.path,json.loads(request.content)))
            return httpx.Response(200,json={'done':True,'done_reason':'stop','message':{'content':'红色茶杯。'}})
        with tempfile.TemporaryDirectory() as temporary:
            lease=ModelLease(Path(temporary));lease.acquire('background')
            resource=LocalVisualResource(lease,transport=httpx.MockTransport(respond))
            await resource.prepare('http://localhost:11434/v1/chat/completions','vision')
            body={'model':'vision','stream':False,'temperature':0,'max_tokens':160,'messages':[
                {'role':'system','content':'只描述可见内容'},
                {'role':'user','content':[{'type':'text','text':'描述采样帧'},{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,/9j/2Q=='}}]}]}
            result=await resource.infer(body)
            self.assertEqual(result['choices'][0],{'message':{'content':'红色茶杯。'},'finish_reason':'stop'})
            path,request=requests[0]
            self.assertEqual(path,'/api/chat');self.assertFalse(request['think']);self.assertEqual(request['keep_alive'],0)
            self.assertEqual(request['options'],{'temperature':0,'num_predict':160})
            self.assertEqual(request['messages'][1]['images'],['/9j/2Q=='])
            for invalid in [None,{},dict(body,model='other'),dict(body,max_tokens=500)]:
                with self.assertRaisesRegex(ValueError,'MEDIA_VISUAL_FAILED'):await resource.infer(invalid)
            self.assertEqual(len(requests),1)
            lease.close()

    async def test_supported_service_is_reserved_before_inference_and_unloaded_before_release(self):
        calls = []
        def respond(request):
            calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
            if request.url.path == '/api/version':
                return httpx.Response(200, json={'version': '0.24.0'})
            if request.url.path == '/api/generate':
                self.assertTrue((folder/'.external-visual.json').is_file())
                return httpx.Response(200, json={'done': True, 'done_reason': 'unload'})
            return httpx.Response(200, json={'models': []})
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            lease = ModelLease(folder)
            lease.acquire('background')
            resource = LocalVisualResource(lease, transport=httpx.MockTransport(respond))
            await resource.prepare('http://127.0.0.1:11434/v1/chat/completions', 'vision:3b')
            self.assertTrue((folder/'.external-visual.json').is_file())
            competitor = ModelLease(folder)
            with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                competitor.acquire('background')
            await resource.release()
            self.assertFalse((folder/'.external-visual.json').exists())
            self.assertIsNotNone(lease.fd)
            self.assertEqual(calls[1], ('POST', '/api/generate', {'model':'vision:3b', 'stream':False, 'keep_alive':0}))
            await resource.release()
            self.assertEqual(len(calls), 3)
            lease.close()
            competitor.acquire('background')
            competitor.close()

    async def test_failed_or_unconfirmed_unload_keeps_crash_recovery_fence(self):
        for failure in ['http', 'resident', 'wrong-ack']:
            def respond(request):
                if request.url.path == '/api/version':
                    return httpx.Response(200, json={'version':'0.24.0'})
                if request.url.path == '/api/generate':
                    return httpx.Response(503 if failure=='http' else 200,
                                          json={'done': True, 'done_reason':'stop' if failure=='wrong-ack' else 'unload'})
                return httpx.Response(200, json={'models':[{'name':'vision:latest'}]})
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                lease = ModelLease(Path(temporary));lease.acquire('background')
                resource = LocalVisualResource(lease, transport=httpx.MockTransport(respond))
                await resource.prepare('http://localhost:11434/v1/chat/completions', 'vision')
                with self.assertRaisesRegex(ValueError, 'MEDIA_VISUAL_RELEASE'):
                    await resource.release()
                self.assertTrue((lease.folder/'.external-visual.json').exists())
                lease.close()

    async def test_generic_compatible_or_nonlocal_endpoint_never_starts_or_unloads_a_model(self):
        calls=[]
        def respond(request):
            calls.append(request.url.path)
            return httpx.Response(404, json={'error':'generic OpenAI compatible server'})
        with tempfile.TemporaryDirectory() as temporary:
            lease=ModelLease(Path(temporary));lease.acquire('background')
            resource=LocalVisualResource(lease,transport=httpx.MockTransport(respond))
            for endpoint in ['https://example.com/v1/chat/completions', 'http://user:secret@localhost/v1/chat/completions',
                             'http://localhost/proxy/v1/chat/completions', 'http://localhost/v1/chat/completions']:
                with self.assertRaisesRegex(ValueError, 'MEDIA_VISUAL_SERVICE'):
                    await resource.prepare(endpoint, 'vision')
            self.assertEqual(calls, ['/api/version'])
            self.assertFalse((lease.folder/'.external-visual.json').exists())
            lease.close()


class ExternalVisualRecoveryContracts(unittest.TestCase):
    def test_crash_recovery_uses_documented_unload_under_exclusive_os_lock(self):
        real_client=httpx.Client
        for confirmed in [False,True]:
            with self.subTest(confirmed=confirmed),tempfile.TemporaryDirectory() as temporary:
                folder=Path(temporary)
                marker=folder/'.external-visual.json'
                marker.write_text(json.dumps({'endpoint':'http://localhost:11434/v1/chat/completions','model':'vision'}))
                calls=[]
                def respond(request):
                    competitor=ModelLease(folder)
                    with self.assertRaisesRegex(ValueError,'ASR_BUSY'):competitor.acquire('background')
                    self.assertIsNone(competitor.fd)
                    calls.append(request.url.path)
                    if request.url.path=='/api/generate':
                        self.assertEqual(json.loads(request.content),{'model':'vision','stream':False,'keep_alive':0})
                        return httpx.Response(200,json={'done':True,'done_reason':'unload'})
                    return httpx.Response(200,json={'models':[] if confirmed else [{'name':'vision:latest'}]})
                with patch('httpx.Client',side_effect=lambda **options:real_client(**options,transport=httpx.MockTransport(respond))):
                    lease=ModelLease(folder)
                    if confirmed:
                        lease.acquire('background');self.assertIsNotNone(lease.fd);self.assertFalse(marker.exists())
                    else:
                        with self.assertRaisesRegex(ValueError,'ASR_BUSY'):lease.acquire('background')
                        self.assertIsNone(lease.fd);self.assertTrue(marker.exists())
                    lease.close()
                self.assertEqual(calls,['/api/generate','/api/ps'])

    def test_new_model_owner_recovers_or_refuses_an_unreleased_external_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);folder.joinpath('.external-visual.json').write_text(json.dumps({'endpoint':'http://127.0.0.1:11434/v1/chat/completions','model':'vision'}))
            lease=ModelLease(folder)
            with patch('local_visual_resource.recover_external_visual', side_effect=ValueError('MEDIA_VISUAL_RELEASE')) as recover:
                with self.assertRaisesRegex(ValueError, 'ASR_BUSY'):
                    lease.acquire('background')
                recover.assert_called_once_with(folder.resolve())
                self.assertIsNone(lease.fd)
            with patch('local_visual_resource.recover_external_visual') as recover:
                lease.acquire('background')
                recover.assert_called_once_with(folder.resolve())
                self.assertIsNotNone(lease.fd)
            lease.close()
