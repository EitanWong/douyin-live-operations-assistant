import asyncio
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from data_location import DataLocation
from local_asr import LocalASR
from public_media_jobs import PublicMediaJobs
from public_media_worker import DownloadedMedia, PublicMediaWorker
from model_lease import ModelLease


@unittest.skipUnless(shutil.which('ffmpeg'), 'real FFmpeg required')
class PublicMediaNoAudioContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.location = DataLocation(settings=self.root/'settings.json', database=str(self.root/'archive.sqlite3'))
        self.path = self.root/'noaudio.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                        '-f', 'lavfi', '-i', 'color=c=red:s=96x64:r=10:d=1',
                        '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=10:d=1',
                        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
                        '-c:v', 'mpeg4', '-threads', '1', str(self.path)], check=True, capture_output=True)
        self.request = {'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70',
                        'author':'author-sec','url':'https://www.douyin.com/video/70','visualVersion':1}
        self.job = self.call('submit', self.request)
        self.asr = LocalASR(self.root/'uninstalled-model')
        self.observed = []

    async def asyncTearDown(self):
        self.asr.close()
        self.temp.cleanup()

    def call(self, method, *args, **kwargs):
        with self.location.open() as store:
            return getattr(PublicMediaJobs(store.db), method)(*args, **kwargs)

    async def download(self, job, folder):
        target = folder/'media.mp4'; shutil.copyfile(self.path, target)
        return DownloadedMedia(target, 2000)

    async def visual(self, job, frame):
        self.assertIsNone(self.asr.recognizer)
        self.assertIsNotNone(self.asr.lease.fd, 'background reservation still fences live model ownership')
        self.observed.append(frame.at_ms)
        return {'text':'红色背景。' if frame.at_ms==0 else '蓝色背景。','model':'noaudio-fixture-v1'}

    def worker(self, visual=None, download=None):
        return PublicMediaWorker(self.location, self.asr, shutil.which('ffmpeg'),
                                 download=download or self.download, visual=visual or self.visual,
                                 heartbeat_seconds=.02)

    async def test_no_audio_video_decodes_without_loading_asr_and_preserves_true_coverage(self):
        with patch.object(self.asr, '_prepare', side_effect=AssertionError('no speech model for absent audio')):
            result = await self.worker().run_once()
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['cursorMs'], 0, 'no fabricated transcript coverage')
        self.assertEqual(result['coverage']['audio'], 'absent')
        self.assertEqual(result['coverage']['durationMs'], 2000)
        self.assertEqual(result['coverage']['video'], 'sampled')
        self.assertEqual(result['visual']['completed'], 2)
        self.assertEqual(self.observed, [0, 1000])
        self.assertEqual([r['kind'] for r in self.call('evidence', self.job['id'])], ['visual','visual'])
        self.assertIsNone(self.asr.lease.fd)

    async def test_no_audio_visual_checkpoint_survives_reopen_without_transcript_or_duplicate_frame(self):
        async def interrupted(job, frame):
            if frame.at_ms>0: raise ValueError('LOCAL_ASR_PREEMPTED')
            return await self.visual(job, frame)
        result = await self.worker(interrupted).run_once()
        self.assertEqual(result['status'], 'paused');self.assertEqual(result['visual']['completed'], 1)
        self.assertEqual(result['coverage']['audio'], 'absent')
        with self.location.open() as store:
            store.db.execute('UPDATE public_media_jobs SET not_before=0');store.db.commit()
        self.observed.clear()
        result = await self.worker().run_once()
        self.assertEqual(result['status'], 'succeeded');self.assertEqual(self.observed,[1000])
        self.assertEqual(len(self.call('evidence', self.job['id'])), 2)

    async def test_completed_no_audio_job_can_be_cancelled_and_resubmitted_without_reanalyzing_frames(self):
        result=await self.worker().run_once();self.assertEqual(result['status'],'succeeded')
        self.call('cancel',self.job['id'],'1','10');self.call('submit',self.request)
        self.observed.clear();result=await self.worker().run_once()
        self.assertEqual(result['status'],'succeeded');self.assertEqual(self.observed,[])
        self.assertEqual(result['coverage']['audio'],'absent')
        self.assertEqual(len(self.call('evidence',self.job['id'])),2)

    async def test_truncated_duration_and_corrupt_media_do_not_become_audio_absence_success(self):
        async def wrong_duration(job, folder):
            downloaded=await self.download(job,folder);return DownloadedMedia(downloaded.path,20000)
        result=await self.worker(download=wrong_duration).run_once()
        self.assertEqual(result['status'],'paused');self.assertEqual(result['error'],'MEDIA_DECODE_FAILED')
        self.assertEqual(result['coverage']['audio'],'pending');self.assertEqual(self.observed,[])
        self.path.write_bytes(b'not media')
        with self.location.open() as store:
            store.db.execute('UPDATE public_media_jobs SET not_before=0');store.db.commit()
        result=await self.worker().run_once()
        self.assertEqual(result['error'],'MEDIA_DECODE_FAILED')
        self.assertNotEqual(result['status'],'succeeded');self.assertEqual(self.call('evidence',self.job['id']),[])

    async def test_audio_only_job_reports_absence_instead_of_fabricating_transcript(self):
        self.call('cancel',self.job['id'],'1','10')
        request={k:v for k,v in self.request.items() if k!='visualVersion'};job=self.call('submit',request)
        result=await self.worker().run_once()
        self.assertEqual(result['id'],job['id']);self.assertEqual(result['status'],'failed')
        self.assertEqual(result['error'],'MEDIA_AUDIO_ABSENT');self.assertEqual(self.observed,[])
        self.assertEqual(self.call('evidence',job['id']),[])

    async def test_real_truncated_video_payload_is_decode_failure_despite_valid_container_header(self):
        fast=self.root/'fast.mp4'
        subprocess.run([shutil.which('ffmpeg'),'-nostdin','-hide_banner','-loglevel','error','-y',
                        '-i',str(self.path),'-c','copy','-movflags','+faststart',str(fast)],check=True,capture_output=True)
        payload=fast.read_bytes();self.path.write_bytes(payload[:len(payload)*3//4])
        result=await self.worker().run_once()
        self.assertEqual(result['status'],'paused');self.assertEqual(result['error'],'MEDIA_DECODE_FAILED')
        self.assertEqual(result['coverage']['audio'],'pending')
        self.assertEqual(self.observed,[]);self.assertEqual(self.call('evidence',self.job['id']),[])

    async def test_forget_cancels_no_audio_visual_and_erases_absence_state_and_late_results(self):
        started,cancelled=asyncio.Event(),asyncio.Event()
        async def pending(job,frame):
            started.set()
            try:await asyncio.Future()
            finally:cancelled.set()
        task=asyncio.create_task(self.worker(pending).run_once())
        await asyncio.wait_for(started.wait(),2)
        self.call('forget','1','10','uid:2',0)
        result=await asyncio.wait_for(task,2)
        self.assertEqual(result['status'],'cancelled');self.assertTrue(cancelled.is_set())
        self.assertEqual(result['coverage']['audio'],'pending');self.assertIsNone(result['visual'])
        self.assertEqual(self.call('evidence',self.job['id']),[]);self.assertIsNone(self.asr.lease.fd)

    async def test_live_intent_blocks_download_without_loading_or_releasing_another_owner(self):
        live=ModelLease(self.asr.folder);downloaded=[]
        async def download(job,folder):downloaded.append(job);return await self.download(job,folder)
        try:
            live.acquire('live')
            result=await self.worker(download=download).run_once()
            self.assertEqual(result['status'],'paused');self.assertEqual(result['error'],'live-asr')
            self.assertEqual(downloaded,[]);self.assertIsNotNone(live.fd);self.assertIsNone(self.asr.recognizer)
        finally:live.close()

    async def test_absent_audio_requires_bound_visual_job_and_cannot_complete_without_all_frames(self):
        claim=self.call('claim','absence');key=claim['id'];lease=claim['lease']
        with self.assertRaisesRegex(ValueError,'MEDIA_UNBOUND'):self.call('mark_audio_absent',key,lease,2000)
        self.call('bind_media',key,lease,'a'*64)
        self.call('mark_audio_absent',key,lease,2000)
        with self.assertRaisesRegex(ValueError,'MEDIA_COVERAGE'):self.call('complete',key,lease,2000)
        self.call('configure_visual',key,lease,2000)
        self.call('checkpoint_visual',key,lease,0,0,'red','fixture')
        with self.assertRaisesRegex(ValueError,'MEDIA_COVERAGE'):self.call('complete',key,lease,2000)
        with self.assertRaisesRegex(ValueError,'MEDIA_COVERAGE'):self.call('mark_audio_absent',key,lease,3000)
        self.call('bind_media',key,lease,'b'*64)
        self.assertEqual(self.call('get',key)['coverage']['audio'],'pending')
        self.assertIsNone(self.call('get',key)['visual']);self.assertEqual(self.call('evidence',key),[])
