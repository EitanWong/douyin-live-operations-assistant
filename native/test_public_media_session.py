import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from public_media_session import PublicMediaSession
from public_media_frames import Keyframe


class PublicMediaSessionContracts(unittest.IsolatedAsyncioTestCase):
    async def test_visual_reply_is_correlated_bounded_and_cancelled_requests_do_not_revive(self):
        emitted=[]
        job={'id':'a'*64,'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70',
             'author':'author-sec','mediaHash':'b'*64,'analysisVersion':'sensevoice-v1+keyframes-v1','knowledgeVersion':0}
        with tempfile.TemporaryDirectory() as folder:
            session=PublicMediaSession(Path(folder),emitted.append)
            task=asyncio.create_task(session.analyze(job,Keyframe(1000,b'\xff\xd8\xff\xd9')))
            await asyncio.sleep(0)
            request=emitted[-1];self.assertEqual(request['type'],'public-media-visual')
            session.handle({'action':'visual-result','id':'wrong','text':'wrong frame'})
            self.assertFalse(task.done())
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
                self.assertEqual(emitted[-1]['value'],{'publicMedia':3,'modelLease':1,'keyframes':1})
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
