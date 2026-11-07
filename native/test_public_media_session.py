import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from model_lease import ModelLease

from public_media_session import PublicMediaSession
from public_media_frames import Keyframe


class PublicMediaSessionContracts(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_and_disconnect_hold_ownership_until_external_unload_acknowledgement(self):
        for mode in ['cancel', 'disconnect', 'success']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                folder=Path(temporary);lease=ModelLease(folder);lease.acquire('background')
                emitted=[];releasing=asyncio.Event();acknowledged=asyncio.Event()
                class Resource:
                    async def prepare(self, endpoint, model):pass
                    async def release(self):
                        releasing.set()
                        await acknowledged.wait()
                session=PublicMediaSession(folder, emitted.append)
                session.lease=lease
                job=dict(id='a'*64,room='1',anchor='10',subject='uid:2',epoch=0,workId='70',author='author-sec',
                         mediaHash='b'*64,analysisVersion='sensevoice-v1+keyframes-v1',knowledgeVersion=0)
                with patch('public_media_session.LocalVisualResource',return_value=Resource()):
                    task=asyncio.create_task(session.analyze(job,Keyframe(0,b'jpeg')))
                    await asyncio.sleep(0);request=emitted[-1]
                    session.handle({'id':request['id'],'action':'visual-resource','endpoint':'http://127.0.0.1:11434/v1/chat/completions','model':'vision'})
                    await asyncio.sleep(0)
                    if mode=='success':
                        session.handle({'id':request['id'],'action':'visual-result','text':'红色茶杯','model':'vision'})
                    elif mode=='disconnect':
                        session.task=task
                        closing=asyncio.create_task(session.close())
                    else:
                        task.cancel()
                    await asyncio.wait_for(releasing.wait(),1)
                    self.assertFalse(task.done())
                    competitor=ModelLease(folder)
                    with self.assertRaisesRegex(ValueError,'ASR_BUSY'):competitor.acquire('background')
                    # Repeated cancellation must not interrupt teardown.
                    if mode!='success':task.cancel()
                    acknowledged.set()
                    if mode=='success':self.assertEqual(await task,{'text':'红色茶杯','model':'vision'})
                    else:await asyncio.gather(task,return_exceptions=True)
                    if mode=='disconnect':await closing
                    self.assertEqual(session.pending,{})
                    lease.close();competitor.acquire('background');competitor.close()

    async def test_visual_reply_is_correlated_bounded_and_cancelled_requests_do_not_revive(self):
        emitted=[]
        job={'id':'a'*64,'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70',
             'author':'author-sec','mediaHash':'b'*64,'analysisVersion':'sensevoice-v1+keyframes-v1','knowledgeVersion':0}
        with tempfile.TemporaryDirectory() as folder:
            session=PublicMediaSession(Path(folder),emitted.append)
            session.lease=object()
            mocked=patch('public_media_session.LocalVisualResource')
            resource=mocked.start().return_value
            self.addCleanup(mocked.stop)
            resource.prepare=AsyncMock();resource.release=AsyncMock()
            task=asyncio.create_task(session.analyze(job,Keyframe(1000,b'\xff\xd8\xff\xd9')))
            await asyncio.sleep(0)
            request=emitted[-1];self.assertEqual(request['type'],'public-media-visual')
            session.handle({'action':'visual-result','id':'wrong','text':'wrong frame'})
            self.assertFalse(task.done())
            session.handle({'action':'visual-resource','id':request['id'],'endpoint':'http://localhost/v1/chat/completions','model':'fixture-vision'})
            await asyncio.sleep(0)
            session.handle({'action':'visual-result','id':request['id'],'text':'红色茶杯。','model':'fixture-vision'})
            self.assertEqual(await task,{'text':'红色茶杯。','model':'fixture-vision'});self.assertEqual(session.pending,{})
            session.handle({'action':'visual-result','id':request['id'],'text':'late'})
            pending=asyncio.create_task(session.analyze(job,Keyframe(2000,b'\xff\xd8\xff\xd9')))
            await asyncio.sleep(0);request=emitted[-1];pending.cancel()
            with self.assertRaises(asyncio.CancelledError):await pending
            self.assertEqual(session.pending,{})
            self.assertEqual(emitted[-1],{'id':request['id'],'type':'public-media-visual-cancel'})
            pending=asyncio.create_task(session.analyze(job,Keyframe(3000,b'\xff\xd8\xff\xd9')))
            await asyncio.sleep(0);request=emitted[-1]
            session.handle({'action':'visual-result','id':request['id'],'text':'x'*1201})
            with self.assertRaisesRegex(ValueError,'MEDIA_VISUAL_FAILED'):await pending

    async def test_disconnect_joins_native_inference_before_unloading_even_after_browser_vanishes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);lease=ModelLease(folder);lease.acquire('background')
            emitted=[];entered=asyncio.Event();finish=asyncio.Event();events=[]
            class Resource:
                async def prepare(self, endpoint, model):pass
                async def infer(self, body):
                    entered.set();await finish.wait();events.append('inference-drained');return {}
                async def release(self):events.append('unload-ack')
            session=PublicMediaSession(folder,emitted.append);session.lease=lease
            job=dict(id='a'*64,room='1',anchor='10',subject='uid:2',epoch=0,workId='70',author='author-sec',mediaHash='b'*64,analysisVersion='sensevoice-v1+keyframes-v1',knowledgeVersion=0)
            with patch('public_media_session.LocalVisualResource',return_value=Resource()):
                session.task=asyncio.create_task(session.analyze(job,Keyframe(0,b'jpeg')))
                await asyncio.sleep(0);request=emitted[-1]
                session.handle({'action':'visual-resource','id':request['id'],'endpoint':'http://localhost/v1/chat/completions','model':'vision'})
                await asyncio.sleep(0)
                session.handle({'action':'visual-infer','id':request['id'],'body':{}})
                await entered.wait()
                def disconnected(value):raise BrokenPipeError()
                session.emit=disconnected
                closing=asyncio.create_task(session.close());await asyncio.sleep(0);await asyncio.sleep(0)
                self.assertFalse(closing.done());self.assertEqual(events,[])
                finish.set();await closing
                self.assertEqual(events,['inference-drained','unload-ack'])
            lease.close()

    async def test_capability_probe_does_not_load_model_and_run_is_single_then_closes_after_one_idle_result(self):
        emitted=[]
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'runtime.json').write_text(json.dumps({'ffmpeg':'fixture','asrModelDir':'model'}))
            gate=asyncio.Event()
            class Worker:
                calls=0
                async def run_once(self):
                    self.calls+=1
                    await gate.wait()
                    return None
            worker=Worker()
            with patch('public_media_session.PublicMediaWorker',return_value=worker),patch('public_media_session.LocalASR') as asr:
                session=PublicMediaSession(root,emitted.append)
                session.handle({'id':'probe','action':'capabilities'})
                self.assertEqual(emitted[-1]['value'],{'publicMedia':5,'modelLease':1,'keyframes':1,'visualRelease':1})
                asr.assert_not_called()
                session.handle({'id':'one','action':'run'})
                session.handle({'id':'two','action':'run'})
                await asyncio.sleep(0)
                self.assertEqual(worker.calls,1)
                gate.set()
                await session.task
                self.assertEqual(emitted[-1],{'type':'public-media-idle'})
                await session.close()

    async def test_disconnect_cancels_and_joins_inflight_worker(self):
        emitted=[];started=asyncio.Event();cancelled=asyncio.Event()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'runtime.json').write_text(json.dumps({'ffmpeg':'fixture','asrModelDir':'model'}))
            class Worker:
                async def run_once(self):
                    started.set()
                    try: await asyncio.Future()
                    finally:cancelled.set()
            with patch('public_media_session.PublicMediaWorker',return_value=Worker()),patch('public_media_session.LocalASR'):
                session=PublicMediaSession(root,emitted.append)
                session.handle({'id':'run','action':'run'})
                await started.wait();await session.close()
                self.assertTrue(cancelled.is_set())
                self.assertTrue(session.task.done())


if __name__=='__main__':unittest.main()
