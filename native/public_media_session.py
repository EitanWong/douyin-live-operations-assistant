"""Dedicated native-messaging session for persisted public-media jobs."""
import asyncio
import json
import base64
import uuid

from data_location import DataLocation
from local_asr import LocalASR
from public_media_worker import PublicMediaWorker
from local_visual_resource import LocalVisualResource


class PublicMediaSession:
    def __init__(self, root, emit):
        self.root, self.emit, self.task = root, emit, None
        self.pending = {}
        self.lease = None

    def notify(self, value):
        try:
            self.emit(value)
        except (BrokenPipeError, OSError):
            pass

    async def prepare_visual(self, request, message):
        try:
            await request['resource'].prepare(message.get('endpoint'), message.get('model'))
            request['model'] = message['model']
            self.notify({'id':message['id'], 'type':'public-media-visual-ready'})
        except Exception:
            self.notify({'id':message['id'], 'type':'public-media-visual-ready', 'error':True})
            if not request['result'].done():
                request['result'].set_exception(ValueError('MEDIA_VISUAL_FAILED'))

    async def release_visual(self, request):
        if request['prepare']:
            await request['prepare']
            if request['infer']:
                await request['infer']
            await request['resource'].release()

    async def infer_visual(self, request, message):
        try:
            value = await request['resource'].infer(message.get('body'))
            self.notify({'id':message['id'], 'type':'public-media-visual-response', 'value':value})
        except Exception:
            self.notify({'id':message['id'], 'type':'public-media-visual-response', 'error':True})

    def handle(self, message):
        action = message.get('action')
        if action == 'capabilities':
            self.emit({'id': message.get('id'), 'value': {'publicMedia': 5, 'modelLease': 1, 'keyframes': 1, 'visualRelease': 1}})
        elif action == 'visual-resource':
            request = self.pending.get(message.get('id'))
            if request is not None and not request['closing'] and request['prepare'] is None and self.lease is not None:
                request['resource'] = LocalVisualResource(self.lease)
                request['prepare'] = asyncio.create_task(self.prepare_visual(request, message))
        elif action == 'visual-result':
            request = self.pending.get(message.get('id'))
            if request is None or request['result'].done():
                return
            future = request['result']
            text = message.get('text')
            model = message.get('model')
            if message.get('error') or not request['model'] or model != request['model'] or not isinstance(text, str) or len(text) > 1200 or '\x00' in text:
                future.set_exception(ValueError('MEDIA_VISUAL_FAILED'))
            else:
                future.set_result({'text':text,'model':model})
        elif action == 'visual-infer':
            request = self.pending.get(message.get('id'))
            if request and request['model'] and not request['closing'] and request['infer'] is None:
                request['infer'] = asyncio.create_task(self.infer_visual(request, message))
        elif action == 'run':
            if self.task is None or self.task.done():
                self.task = asyncio.create_task(self.run())
            self.emit({'id': message.get('id'), 'value': {'accepted': True}})
        else:
            self.emit({'id': message.get('id'), 'error': 'MEDIA_OPERATION'})

    async def analyze(self, job, frame):
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        request = {'result':future, 'prepare':None, 'resource':None, 'model':None, 'infer':None, 'closing':False}
        self.pending[request_id] = request
        try:
            fields = ('id','room','anchor','subject','epoch','workId','author','mediaHash','analysisVersion','knowledgeVersion')
            self.emit({'id':request_id,'type':'public-media-visual','job':{key:job[key] for key in fields},
                       'frame':{'atMs':frame.at_ms,'data':base64.b64encode(frame.data).decode('ascii')}})
            async with asyncio.timeout(20):
                return await asyncio.shield(future)
        except TimeoutError:
            raise ValueError('MEDIA_VISUAL_FAILED') from None
        finally:
            request['closing'] = True
            self.notify({'id':request_id,'type':'public-media-visual-cancel'})
            cleanup = asyncio.create_task(self.release_visual(request))
            interrupted = False
            try:
                while not cleanup.done():
                    try:
                        await asyncio.shield(cleanup)
                    except asyncio.CancelledError:
                        interrupted = True
                cleanup.result()
            finally:
                self.pending.pop(request_id, None)
                if not future.done():
                    future.cancel()
                elif not future.cancelled():
                    future.exception()
            if interrupted:
                raise asyncio.CancelledError()

    async def run(self):
        try:
            runtime = json.loads((self.root/'runtime.json').read_text())
            asr = LocalASR(runtime.get('asrModelDir'))
            self.lease = asr.lease
            worker = PublicMediaWorker(DataLocation(), asr, runtime['ffmpeg'], visual=self.analyze)
            while True:
                result = await worker.run_once()
                if result is None:
                    break
                self.emit({'type': 'public-media-result', 'value': result})
        except asyncio.CancelledError:
            raise
        except Exception:
            self.emit({'type': 'public-media-result', 'value': {'status': 'unavailable'}})
        finally:
            self.notify({'type': 'public-media-idle'})

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
