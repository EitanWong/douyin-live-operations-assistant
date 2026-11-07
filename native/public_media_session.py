"""Dedicated native-messaging session for persisted public-media jobs."""
import asyncio
import json

from data_location import DataLocation
from local_asr import LocalASR
from public_media_worker import PublicMediaWorker


class PublicMediaSession:
    def __init__(self, root, emit):
        self.root, self.emit, self.task = root, emit, None

    def handle(self, message):
        action = message.get('action')
        if action == 'capabilities':
            self.emit({'id': message.get('id'), 'value': {'publicMedia': 2, 'modelLease': 1}})
        elif action == 'run':
            if self.task is None or self.task.done():
                self.task = asyncio.create_task(self.run())
            self.emit({'id': message.get('id'), 'value': {'accepted': True}})
        else:
            self.emit({'id': message.get('id'), 'error': 'MEDIA_OPERATION'})

    async def run(self):
        try:
            runtime = json.loads((self.root/'runtime.json').read_text())
            worker = PublicMediaWorker(DataLocation(), LocalASR(runtime.get('asrModelDir')), runtime['ffmpeg'])
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
