"""Exercise configured locations through reopen, failure, crash recovery and stdio."""
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from data_location import DataLocation, LocationError, save_json as original_save


def observation(key='a'):
    return {'id': key, 'room': '361690799431', 'anchor': '3804784440654216',
            'kind': 'event', 'receivedAt': 1000, 'payload': {'type': 'chat', 'text': '测试'}}


class ConfiguredLocation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.settings = self.root / 'control/settings.json'
        self.default = self.root / 'original/live.sqlite3'
        self.location = DataLocation(settings=self.settings, fallback=self.default)
        with self.location.open() as store:
            store.append([observation()])

    def tearDown(self):
        self.temp.cleanup()

    def test_migration_keeps_data_replays_and_reopens_from_saved_location(self):
        folder = self.root / '自定义 空间'
        result = self.location.relocate(str(folder), str(self.default))
        target = folder / 'live.sqlite3'
        self.assertEqual(result['database'], str(target))
        self.assertEqual(result['records'], 1)
        self.assertTrue(self.default.exists(), 'original remains a recovery snapshot')
        reopened = DataLocation(settings=self.settings, fallback=self.default)
        with reopened.open() as store:
            self.assertEqual(store.append([observation()])['inserted'], 0)
            store.append([observation('b')])
            self.assertEqual(store.status()['records'], 2)
        self.assertEqual(self.location.relocate(str(folder), str(self.default))['records'], 2)
        self.assertEqual(self.settings.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_invalid_stale_and_existing_destinations_never_change_current_data(self):
        for directory in ('relative/path', '', 'https://example.com/data'):
            with self.assertRaises(LocationError):
                self.location.relocate(directory, str(self.default))
        with self.assertRaises(LocationError):
            self.location.relocate(str(self.root/'new'), str(self.root/'stale.sqlite3'))
        folder = self.root/'existing'
        folder.mkdir()
        (folder/'live.sqlite3').write_text('user file')
        with self.assertRaises(LocationError):
            self.location.relocate(str(folder), str(self.default))
        self.assertEqual((folder/'live.sqlite3').read_text(), 'user file')
        with self.location.open() as store:
            self.assertEqual(store.path, self.default)
            self.assertEqual(store.status()['records'], 1)

    def test_failed_copy_keeps_original_active_and_can_retry_same_directory(self):
        folder = self.root/'retry'
        with patch('data_location.DataStore.backup', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.location.relocate(str(folder), str(self.default))
        self.assertFalse(self.settings.exists())
        self.assertEqual(self.location.relocate(str(folder), str(self.default))['records'], 1)

    def test_interrupted_switch_recovers_before_any_new_writer_chooses_database(self):
        folder = self.root/'recover'
        with patch('data_location.save_json', side_effect=lambda path, value: (_ for _ in ()).throw(OSError('interrupted')) if path == self.settings else original_save(path, value)):
            with self.assertRaises(OSError):
                self.location.relocate(str(folder), str(self.default))
        recovered = DataLocation(settings=self.settings, fallback=self.default)
        with recovered.open() as store:
            self.assertEqual(store.path, folder/'live.sqlite3')
            self.assertEqual(store.status()['records'], 1)
            store.append([observation('after-recovery')])
        with self.location.open() as store:
            self.assertEqual(store.status()['records'], 2)

    def test_stdio_location_setting_is_used_by_later_process_without_database_flag(self):
        folder = self.root/'stdio'
        self.location.relocate(str(folder), str(self.default))
        raw = json.dumps({'id':'probe','action':'status'}).encode()
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('data_host.py')), '--settings', str(self.settings)],
                                input=struct.pack('<I', len(raw))+raw, capture_output=True, check=True, timeout=10)
        size, = struct.unpack('<I', result.stdout[:4])
        reply = json.loads(result.stdout[4:4+size])
        self.assertEqual(reply['value']['database'], str(folder/'live.sqlite3'))
        self.assertEqual(reply['value']['records'], 1)

    def test_missing_custom_device_does_not_create_empty_replacement(self):
        folder = self.root/'device'
        self.location.relocate(str(folder), str(self.default))
        target = folder/'live.sqlite3'
        target.rename(folder/'temporarily-unavailable.sqlite3')
        with self.assertRaises(LocationError):
            with self.location.open():
                pass
        with self.assertRaises(LocationError):
            self.location.relocate(str(self.root/'new-device'), str(target))
        self.assertFalse(target.exists())

    def test_another_process_waits_for_writer_then_copies_the_committed_record(self):
        script = '''
import sys
from data_location import DataLocation
print('ready',flush=True)
location=DataLocation(settings=sys.argv[1],fallback=sys.argv[2])
location.relocate(sys.argv[3],sys.argv[2])
'''
        with self.location.open() as store:
            child = subprocess.Popen([sys.executable,'-c',script,str(self.settings),str(self.default),str(self.root/'parallel')],
                                     cwd=Path(__file__).parent,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            store.append([observation('committed-before-copy')])
        stdout, stderr = child.communicate(timeout=15)
        self.assertEqual(child.returncode, 0, stderr)
        with self.location.open() as store:
            self.assertEqual(store.path, self.root/'parallel/live.sqlite3')
            self.assertEqual(store.status()['records'], 2)

    def test_existing_stdio_process_resolves_new_location_for_each_request(self):
        child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('data_host.py')), '--settings',str(self.settings)],
                                 stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        def call(message):
            raw = json.dumps(message).encode()
            child.stdin.write(struct.pack('<I',len(raw))+raw)
            child.stdin.flush()
            size, = struct.unpack('<I',child.stdout.read(4))
            return json.loads(child.stdout.read(size))
        try:
            self.location.relocate(str(self.root/'first'),str(self.default))
            first = call({'id':'first','action':'status'})
            self.assertEqual(first['value']['records'],1)
            self.location.relocate(str(self.root/'second'),str(self.root/'first/live.sqlite3'))
            result = call({'id':'write','action':'append','records':[observation('new-process-target')]})
            self.assertEqual(result['value']['inserted'],1)
            self.assertEqual(call({'id':'last','action':'status'})['value']['records'],2)
        finally:
            child.stdin.close()
            self.assertEqual(child.wait(timeout=10),0,child.stderr.read().decode())
            child.stdout.close()
            child.stderr.close()
