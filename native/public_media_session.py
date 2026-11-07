"""Dedicated native-messaging session for persisted public-media jobs."""
import asyncio
import json
import base64
import uuid

from data_location import DataLocation
from local_asr import LocalASR
from public_media_worker import PublicMediaWorker


class PublicMediaSession:
    def __init__(self, root, emit):
        self.root, self.emit, self.task = root, emit, None
        self.pending = {}

    def handle(self, message):
        action = message.get('action')
        if action == 'capabilities':
            self.emit({'id': message.get('id'), 'value': {'publicMedia': 4, 'modelLease': 1, 'keyframes': 1}})
        elif action == 'visual-result':
            future = self.pending.get(message.get('id'))
            if future is None or future.done():
                return
            text = message.get('text')
            model = message.get('model')
            if message.get('error') or not isinstance(text, str) or len(text) > 1200 or '\x00' in text or not isinstance(model, str) or not 1 <= len(model) <= 200 or '\x00' in model:
                future.set_exception(ValueError('MEDIA_VISUAL_FAILED'))
            else:
                future.set_result({'text':text,'model':model})
        elif action == 'run':
            if self.task is None or self.task.done():
                self.task = asyncio.create_task(self.run())
            self.emit({'id': message.get('id'), 'value': {'accepted': True}})
        else:
            self.emit({'id': message.get('id'), 'error': 'MEDIA_OPERATION'})

    async def analyze(self, job, frame):
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            fields = ('id','room','anchor','subject','epoch','workId','author','mediaHash','analysisVersion','knowledgeVersion')
            self.emit({'id':request_id,'type':'public-media-visual','job':{key:job[key] for key in fields},
                       'frame':{'atMs':frame.at_ms,'data':base64.b64encode(frame.data).decode('ascii')}})
            async with asyncio.timeout(20):
                return await future
        except TimeoutError:
            raise ValueError('MEDIA_VISUAL_FAILED') from None
        finally:
            self.pending.pop(request_id, None)
            self.emit({'id':request_id,'type':'public-media-visual-cancel'})

    async def run(self):
        try:
            runtime = json.loads((self.root/'runtime.json').read_text())
            worker = PublicMediaWorker(DataLocation(), LocalASR(runtime.get('asrModelDir')), runtime['ffmpeg'], visual=self.analyze)
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
            self.emit({'type': 'public-media-idle'})

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
