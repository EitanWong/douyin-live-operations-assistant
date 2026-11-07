"""Integration fixture: real queue/FFmpeg, controlled ASR and downloaded audio."""
import asyncio
from pathlib import Path
import shutil
import sys
import tempfile
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'native'))
from data_location import DataLocation
from local_asr import pcm16
from public_media_worker import DownloadedMedia, PublicMediaWorker


class TranscriptFixture:
    def prepare(self, priority):
        assert priority == 'background'
        return {'phase': 'ready'}

    def check_priority(self):
        pass

    def infer(self, payload):
        assert len(pcm16(payload)) <= 128000
        return '陶瓷茶杯只能用冷水清洗，不能加热。'

    def close(self):
        pass


async def main():
    with tempfile.TemporaryDirectory() as settings:
        location=DataLocation(database=sys.argv[1],settings=Path(settings)/'settings.json')
        async def download(job, folder):
            path=folder/'clip.wav'
            with wave.open(str(path),'wb') as wav:
                wav.setparams((1,2,16000,0,'NONE','not compressed'))
                wav.writeframes(b'\x01\x02'*128000)
            return DownloadedMedia(path,8000)
        result=await PublicMediaWorker(location,TranscriptFixture(),shutil.which('ffmpeg'),download=download).run_once()
        assert result['status']=='succeeded',result


asyncio.run(main())
