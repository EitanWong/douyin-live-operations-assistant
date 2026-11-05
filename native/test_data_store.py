import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

from data_store import DataStore


def record(key='a', room='1', kind='event', at=100000, payload=None):
    return {'id': key, 'room': room, 'anchor': '2', 'kind': kind,
            'receivedAt': at, 'payload': payload or {'type': 'chat', 'text': '喜欢吉他', 'user': {'id': '3'}}}


class LocalDataStore(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'live.sqlite3'
        self.store = DataStore(self.path)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_restart_replay_and_room_isolation(self):
        rows = [record(), record('b', room='9')]
        self.assertEqual(self.store.append(rows)['inserted'], 2)
        self.store.close()
        self.store = DataStore(self.path)
        self.assertEqual(self.store.append(rows)['inserted'], 0)
        result = self.store.summary('1', 200000)
        self.assertEqual(result['eventCounts'], {'chat': 1})
        self.assertEqual(result['observedUsers'], 1)
        self.assertEqual(self.store.status()['records'], 2)
        self.assertNotIn('text', json.dumps(result))

    def test_failed_batch_is_atomic_and_conflicting_replay_is_rejected(self):
        with self.assertRaises(ValueError):
            self.store.append([record(), {**record('b'), 'room': '../bad'}])
        self.assertEqual(self.store.status()['records'], 0)
        self.store.append([record()])
        with self.assertRaises(ValueError):
            self.store.append([record('b'), record(payload={'type': 'chat', 'text': 'changed'})])
        self.assertEqual(self.store.status()['records'], 1)

    def test_export_is_streamed_and_keeps_full_events_but_not_credentials(self):
        with self.assertRaises(ValueError):
            self.store.append([record(payload={'type': 'chat', 'apiKey': 'secret'})])
        self.store.append([record(), record('b', kind='coverage', payload={'connected': False, 'gaps': 4})])
        rows = list(self.store.export('1'))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['payload']['text'], '喜欢吉他')
        self.assertEqual(self.store.summary('1', 200000)['coverage']['gaps'], 4)
        backup = Path(self.temp.name) / 'backup.sqlite3'
        self.store.backup(backup)
        other = DataStore(backup)
        try:
            self.assertEqual(other.status()['records'], 2)
        finally:
            other.close()

    def test_training_joins_only_previously_issued_predictions_and_later_observations(self):
        forecast = {'id': 'flow:10', 'asOf': 10000, 'startAt': 10000, 'dueAt': 310000,
                    'target': 'diamonds', 'horizonMinutes': 5, 'point': 100, 'low': 20, 'high': 180,
                    'baseline': {'point': 90}, 'unit': 'diamonds'}
        report = {'asOf': 20000, 'scope': '1:2', 'forecastHistory': [forecast]}
        self.store.append([record('issue', kind='forecast', at=20000, payload=report)])
        scored = {**forecast, 'evaluation': {'status': 'scored', 'at': 320000, 'actual': 120}}
        forged = {**scored, 'id': 'never-issued'}
        self.store.append([record('label', kind='forecast', at=330000,
                                  payload={'asOf': 330000, 'comparisons': [scored, forged]})])
        dataset = list(self.store.dataset('1'))
        self.assertEqual(len(dataset), 1)
        self.assertEqual(dataset[0]['features']['point'], 100)
        self.assertEqual(dataset[0]['actual'], 120)
        self.assertEqual(dataset[0]['labelAt'], 320000)
        self.assertEqual(dataset[0]['asOf'], 10000)
        self.assertNotIn('actual', dataset[0]['features'])

    def test_future_forecasts_simulations_and_modified_predictions_cannot_train(self):
        f = {'id': 'x', 'asOf': 100, 'dueAt': 200, 'startAt': 100, 'target': 'online',
             'horizonMinutes': 1, 'point': 3, 'low': 1, 'high': 5, 'unit': 'people'}
        self.store.append([record('sim', kind='forecast', payload={'simulated': True, 'forecastHistory': [f]})])
        self.assertEqual(list(self.store.dataset('1')), [])
        self.store.append([record('issue', kind='forecast', at=150, payload={'forecastHistory': [f]})])
        self.store.append([record('bad-label', kind='forecast', at=300, payload={'comparisons': [
            {**f, 'point': 9, 'evaluation': {'status': 'scored', 'at': 250, 'actual': 4}},
            {**f, 'evaluation': {'status': 'scored', 'at': 400, 'actual': 4}}]})])
        self.assertEqual(list(self.store.dataset('1')), [])

    def test_native_host_runs_without_asr_ffmpeg_or_network(self):
        message = {'id': 'rpc', 'action': 'append', 'records': [record()]}
        raw = json.dumps(message).encode()
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('data_host.py')),
                                 '--database', str(self.path)], input=struct.pack('<I', len(raw)) + raw,
                                capture_output=True, timeout=10, check=True)
        size, = struct.unpack('<I', result.stdout[:4])
        response = json.loads(result.stdout[4:4 + size])
        self.assertEqual(response['id'], 'rpc')
        self.assertEqual(response['value']['inserted'], 1)
        self.assertEqual(self.store.status()['records'], 1)

    def test_persisted_model_is_scope_bound_and_never_predicts_before_training(self):
        for i in range(60):
            at = 1000 + i * 120000
            f = {'id': str(i), 'asOf': at, 'startAt': at, 'dueAt': at + 60000, 'target': 'online',
                 'horizonMinutes': 1, 'point': 100, 'low': 50, 'high': 150, 'unit': 'people'}
            self.store.append([record(f'issue-{i}', kind='forecast', at=at + 1, payload={'forecastHistory': [f]})])
            scored = {**f, 'evaluation': {'status': 'scored', 'at': at + 61000, 'actual': 120}}
            self.store.append([record(f'label-{i}', kind='forecast', at=at + 62000, payload={'comparisons': [scored]})])
        model = self.store.train('1', '2', 'online', 1, 8000000)
        self.assertEqual(model['status'], 'validated')
        rows = [{'target': 'online', 'horizonMinutes': 1, 'point': 100, 'low': 50, 'high': 150}]
        self.assertEqual(self.store.predict('1', '2', 7000000, rows)['rows'], [])
        self.assertEqual(self.store.predict('1', '9', 9000000, rows)['rows'], [])
        self.store.close()
        self.store = DataStore(self.path)
        self.assertEqual(self.store.predict('1', '2', 9000000, rows)['rows'][0]['point'], 120)
        self.assertEqual(self.store.predict('1', '2', 9000000, rows)['rows'][0]['unit'], 'people')

    def test_pk_training_keeps_battle_identity_time_and_only_confirmed_final_labels(self):
        pk = {'status': 'ready', 'battleKey': 'battle-1', 'remainingMs': 90000, 'probability': .7}
        self.store.append([record('pk-issue', kind='forecast', at=100000, payload={'asOf': 100000, 'pk': pk})])
        outcome = {'battleKey': 'battle-1', 'endedAt': 200000, 'scoreFinal': False, 'outcome': 'win'}
        self.store.append([record('not-final', kind='pk-state', at=210000, payload={'outcomes': [outcome]})])
        self.assertEqual(list(self.store.pk_dataset('1')), [])
        outcome['scoreFinal'] = True
        self.store.append([record('confirmed', kind='pk-state', at=220000, payload={'outcomes': [outcome]})])
        rows = list(self.store.pk_dataset('1'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['battleKey'], 'battle-1')
        self.assertEqual(rows[0]['features']['probability'], .7)
        self.assertEqual(rows[0]['outcome'], 'win')
        self.assertEqual(rows[0]['labelAt'], 220000)

    def test_audience_interests_require_explicit_expression_and_stable_identity(self):
        self.store.append([record(), record('other', payload={'type': 'chat', 'text': '别人喜欢游戏', 'user': {'id': '4'}}),
                           record('gift', payload={'type': 'gift', 'count': 1000, 'user': {'id': '3'}})])
        viewers = self.store.audience('1', ['uid:3', 'uid:999'])
        self.assertEqual(len(viewers), 2)
        self.assertEqual(viewers[0]['declaredInterests'][0]['topic'], '音乐')
        self.assertEqual(viewers[0]['declaredInterests'][0]['evidence'], '喜欢吉他')
        self.assertEqual(viewers[0]['giftMessages'], 1)
        self.assertNotIn('wealth', json.dumps(viewers))
        self.assertEqual(viewers[1]['declaredInterests'], [])
        self.assertEqual(self.store.audience('9', ['uid:3'])[0]['chatMessages'], 0)


if __name__ == '__main__':
    unittest.main()
