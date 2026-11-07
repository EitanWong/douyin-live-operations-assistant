"""Real native session/FFmpeg with fixture media and ASR; no real model loaded."""
import asyncio
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'native'))
from data_location import DataLocation
from public_media_session import PublicMediaSession
from public_media_worker import PublicMediaWorker, DownloadedMedia
from protocol import read_message, write_message
from test_public_media_worker import FakeASR


async def main():
    with tempfile.TemporaryDirectory() as temporary:
        root=Path(temporary);path=root/'colors.mp4';ffmpeg=shutil.which('ffmpeg')
        subprocess.run([ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-y',
                        '-f','lavfi','-i','color=c=red:s=96x64:r=10:d=1',
                        '-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=1',
                        '-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=2',
                        '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a',
                        '-c:v','mpeg4','-c:a','aac','-threads','1',str(path)],check=True,capture_output=True)
        (root/'runtime.json').write_text(json.dumps({'ffmpeg':ffmpeg}))
        location=DataLocation(database=sys.argv[1],settings=root/'settings.json')
        async def download(job,folder):
            target=folder/'colors.mp4';shutil.copyfile(path,target);return DownloadedMedia(target,2000)
        def worker(*args,**kwargs):return PublicMediaWorker(*args,download=download,heartbeat_seconds=.02,**kwargs)
        with patch('public_media_session.DataLocation',return_value=location),patch('public_media_session.LocalASR',return_value=FakeASR()),patch('public_media_session.PublicMediaWorker',side_effect=worker):
            session=PublicMediaSession(root,lambda value:write_message(value,sys.stdout.buffer))
            try:
                while True:
                    message=await asyncio.to_thread(read_message,sys.stdin.buffer)
                    if message is None:break
                    session.handle(message)
            finally:await session.close()


asyncio.run(main())
