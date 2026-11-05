import asyncio
import unittest
from unittest.mock import patch
from host import session
from protocol import Observer


class Renewal(unittest.IsolatedAsyncioTestCase):
    async def test_transcription_bookkeeping_limit_renews_session_instead_of_waiting_an_hour(self):
        observer=Observer('model', lambda value: None, 10, 1000, clock=lambda:10000)
        for i in range(1201):
            observer.begin(9000, 9800, respond=False)
            if i==1200:
                with self.assertRaisesRegex(ValueError, 'SESSION_LIMIT'):
                    observer.event({'type':'input_audio_buffer.committed','item_id':str(i)})
            else:
                observer.event({'type':'input_audio_buffer.committed','item_id':str(i)})

    async def test_token_rollover_retains_final_observation_and_reopens_without_terminal_error(self):
        emitted=[]
        observer=Observer('model', emitted.append, 10, 10, clock=lambda: 10000)
        observer.begin(9000, 9800)
        observer.event({'type':'response.created','response':{'id':'last'}})
        with self.assertRaisesRegex(ValueError, 'SESSION_LIMIT'):
            observer.event({'type':'response.done','response':{'id':'last','status':'completed','usage':{'total_tokens':10},'output':[{'type':'message','content':[{'type':'text','text':'主播刚说起爷爷的茶杯。'}]}]}})
        self.assertEqual(emitted[0]['row']['text'], '主播刚说起爷爷的茶杯。')
        attempts=[]
        async def run(config, current, binary):
            attempts.append(current)
            if len(attempts)==1:
                current.calls=[10000]
                raise ValueError('SESSION_LIMIT')
            raise asyncio.CancelledError()
        config={'room':'1','model':'model','calls':10,'tokens':10,'minutes':1}
        with patch('host.parse_config',return_value=config), patch('host.run_session',side_effect=run), patch('host.emit',side_effect=emitted.append), patch('host.shutil.which',return_value=__file__):
            with self.assertRaises(asyncio.CancelledError):
                await session({})
        self.assertEqual(len(attempts),2)
        self.assertEqual(attempts[1].calls,[10000])
        self.assertTrue(any(e.get('phase')=='renewing' for e in emitted))
        self.assertFalse(any(e.get('type')=='error' for e in emitted))

    async def test_duration_rollover_and_manual_cancellation(self):
        attempts=[]
        async def run(*args):
            attempts.append(1)
            if len(attempts)==1:
                raise TimeoutError()
            raise asyncio.CancelledError()
        with patch('host.parse_config',return_value={'room':'1','model':'model','calls':10,'tokens':1000,'minutes':1}), patch('host.run_session',side_effect=run), patch('host.emit'), patch('host.shutil.which',return_value=__file__):
            with self.assertRaises(asyncio.CancelledError):
                await session({})
        self.assertEqual(len(attempts),2)

    async def test_hourly_quota_waits_for_window_and_cancellation_stops_renewal(self):
        emitted, delays=[], []
        async def run(config, observer, binary):
            observer.calls=[10000]
            raise ValueError('LIMIT')
        async def wait(delay):
            delays.append(delay)
            raise asyncio.CancelledError()
        with patch('host.parse_config',return_value={'room':'1','model':'model','calls':1,'tokens':1000,'minutes':1}), patch('host.run_session',side_effect=run), patch('host.emit',side_effect=emitted.append), patch('host.shutil.which',return_value=__file__), patch('host.clock',return_value=10000), patch('host.asyncio.sleep',side_effect=wait):
            with self.assertRaises(asyncio.CancelledError):
                await session({})
        self.assertEqual(delays,[3600])
        self.assertEqual(emitted[0]['phase'],'waiting')
        self.assertFalse(any(e.get('type')=='error' for e in emitted))
