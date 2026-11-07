import asyncio
import base64
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from data_location import DataLocation
from public_media_frames import extract_keyframe, frame_positions
from public_media_jobs import PublicMediaJobs
from public_media_worker import DownloadedMedia, PublicMediaWorker
from protocol import write_message
from test_public_media_worker import FakeASR


class VisualPlanContracts(unittest.TestCase):
    def test_plan_spans_beginning_and_end_and_has_a_fixed_frame_budget(self):
        self.assertEqual(frame_positions(500), [0])
        self.assertEqual(frame_positions(8400), [0, 7400])
        positions = frame_positions(10800000)
        self.assertEqual(len(positions), 120)
        self.assertEqual((positions[0], positions[-1]), (0, 10799000))
        self.assertEqual(positions, sorted(set(positions)))
        for invalid in [0, -1, True, 10800001]:
            with self.assertRaises(ValueError): frame_positions(invalid)


@unittest.skipUnless(shutil.which('ffmpeg'), 'real FFmpeg required')
class PublicMediaVisualContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.location = DataLocation(settings=self.root/'settings.json', database=str(self.root/'archive.sqlite3'))
        self.path = self.root/'colors.mp4'
        command = [shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                   '-f', 'lavfi', '-i', 'color=c=red:s=96x64:r=10:d=1',
                   '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=10:d=1',
                   '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=2',
                   '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a',
                   '-c:v', 'mpeg4', '-c:a', 'aac', '-threads', '1', str(self.path)]
        subprocess.run(command, check=True, capture_output=True)
        self.request = {'room':'1','anchor':'10','subject':'uid:2','epoch':0,'workId':'70',
                        'author':'author-sec','url':'https://www.douyin.com/video/70','visualVersion':1}
        self.job = self.call('submit', self.request)

    async def asyncTearDown(self): self.temp.cleanup()

    def call(self, method, *args, **kwargs):
        with self.location.open() as store: return getattr(PublicMediaJobs(store.db), method)(*args, **kwargs)

    async def download(self, job, folder):
        target = folder/'media.mp4'; shutil.copyfile(self.path, target)
        return DownloadedMedia(target, 2000)

    def worker(self, visual):
        return PublicMediaWorker(self.location, FakeASR(), shutil.which('ffmpeg'), download=self.download,
                                 visual=visual, heartbeat_seconds=.02)

    async def test_real_decoder_preserves_frame_time_pixels_and_native_packet_budget(self):
        frames = [await extract_keyframe(shutil.which('ffmpeg'), self.path, position) for position in [0, 1000]]
        for frame, position in zip(frames, [0, 1000]):
            self.assertEqual(frame.at_ms, position)
            self.assertTrue(frame.data.startswith(b'\xff\xd8') and frame.data.endswith(b'\xff\xd9'))
            self.assertLessEqual(len(frame.data), 36000)
            packet = io.BytesIO();write_message({'frame':base64.b64encode(frame.data).decode()},packet)
            self.assertLess(len(packet.getvalue()), 65540)
        for frame, dominant in zip(frames, [0, 2]):
            pixels = subprocess.run([shutil.which('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe',
                                     '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
                                    input=frame.data, capture_output=True, check=True).stdout
            self.assertGreater(pixels[dominant], 200)
            self.assertLess(pixels[2-dominant], 30)

    async def test_visual_checkpoints_survive_interruption_and_unknown_is_not_invented_evidence(self):
        calls=[]
        async def interrupted(job, frame):
            calls.append(frame.at_ms)
            if len(calls)==2: raise ValueError('LOCAL_ASR_PREEMPTED')
            return {'text':'画面是红色背景。','model':'fixture-vision-v1'}
        result=await self.worker(interrupted).run_once()
        self.assertEqual(result['status'],'paused')
        self.assertEqual(result['visual']['completed'],1)
        self.assertNotEqual(result['coverage']['audio'],'complete')
        with self.location.open() as store:
            store.db.execute('UPDATE public_media_jobs SET not_before=0');store.db.commit()
        resumed=[]
        async def unknown(job, frame): resumed.append(frame.at_ms);return {'text':'','model':'fixture-vision-v2'}
        result=await self.worker(unknown).run_once()
        self.assertEqual(resumed,[1000])
        self.assertEqual(result['status'],'succeeded')
        self.assertEqual(result['coverage']['video'],'sampled')
        self.assertEqual(result['coverage']['visual']['completed'],2)
        rows=self.call('evidence',self.job['id'])
        visual=[r for r in rows if r['kind']=='visual']
        self.assertEqual([(r['startMs'],r['endMs'],r['text']) for r in visual],[(0,1,'画面是红色背景。'),(1000,1001,'')])
        self.assertEqual([r['model'] for r in visual],['fixture-vision-v1','fixture-vision-v2'])
        self.assertTrue(all(r['speaker']=='unknown' for r in rows))

    async def test_forget_aborts_pending_visual_and_fences_late_model_text(self):
        started,cancelled=asyncio.Event(),asyncio.Event()
        async def visual(job, frame):
            started.set()
            try: await asyncio.Future()
            finally: cancelled.set()
        task=asyncio.create_task(self.worker(visual).run_once())
        await asyncio.wait_for(started.wait(),2)
        self.call('forget','1','10','uid:2',0)
        result=await asyncio.wait_for(task,2)
        self.assertEqual(result['status'],'cancelled');self.assertTrue(cancelled.is_set())
        self.assertEqual(self.call('evidence',self.job['id']),[])
        self.assertIsNone(result['visual'])

    async def test_visual_mode_cannot_complete_without_planned_samples_and_hash_change_resets_plan(self):
        claim=self.call('claim','fixture');lease=claim['lease'];key=claim['id']
        self.call('bind_media',key,lease,'a'*64)
        self.call('checkpoint',key,lease,[{'kind':'transcript','startMs':0,'endMs':2000,'text':'','speaker':'unknown'}],2000)
        with self.assertRaisesRegex(ValueError,'MEDIA_COVERAGE'):self.call('complete',key,lease,2000)
        self.call('configure_visual',key,lease,2000)
        with self.assertRaisesRegex(ValueError,'MEDIA_VISUAL_FAILED'):self.call('checkpoint_visual',key,lease,1000,1000,'future','fixture')
        self.call('checkpoint_visual',key,lease,0,0,'red','fixture')
        self.assertEqual(self.call('checkpoint_visual',key,lease,0,0,'red','fixture')['completed'],1)
        with self.assertRaisesRegex(ValueError,'MEDIA_SEGMENT_CONFLICT'):self.call('checkpoint_visual',key,lease,0,0,'changed','fixture')
        with self.assertRaisesRegex(ValueError,'MEDIA_SEGMENT_CONFLICT'):self.call('checkpoint_visual',key,lease,0,0,'red','other-model')
        with self.assertRaisesRegex(ValueError,'MEDIA_COVERAGE'):self.call('complete',key,lease,2000)
        self.call('bind_media',key,lease,'b'*64)
        self.assertIsNone(self.call('get',key)['visual'])
        self.assertEqual(self.call('evidence',key),[])

    async def test_largest_visual_jobs_and_evidence_fit_native_response_budget(self):
        self.call('cancel',self.job['id'],'1','10')
        request={**self.request,'author':'a'*160,'subject':'sec:'+'a'*160}
        job=self.call('submit',request);claim=self.call('claim','fixture');key=claim['id'];lease=claim['lease']
        self.assertEqual(key,job['id'])
        self.call('bind_media',key,lease,'a'*64)
        self.call('checkpoint',key,lease,[{'kind':'transcript','startMs':0,'endMs':10800000,'text':'','speaker':'unknown'}],10800000)
        plan=self.call('configure_visual',key,lease,10800000)
        for position in plan['positionsMs']:
            self.call('checkpoint_visual',key,lease,position,position,'😀'*1200,'🔥'*200)
        result=self.call('complete',key,lease,10800000)
        self.assertEqual(result['visual']['planned'],120);self.assertNotIn('positionsMs',result['visual'])
        for value in [{'value':[result]*32},{'value':self.call('evidence',key)}]:
            packet=io.BytesIO();write_message(value,packet);self.assertLessEqual(len(packet.getvalue()),65540)

    async def test_decoder_error_is_not_successful_visual_coverage(self):
        with self.assertRaisesRegex(ValueError,'MEDIA_VISUAL_FAILED'):
            await extract_keyframe(shutil.which('ffmpeg'),self.path,100000)
