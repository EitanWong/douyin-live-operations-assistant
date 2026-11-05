import unittest
from data_models import train_calibration, predict_calibration


def samples(count=100, error=20):
    return [{'id': str(i), 'asOf': 1000 + i * 120000, 'dueAt': 61000 + i * 120000,
             'labelAt': 62000 + i * 120000, 'features': {'point': 100 + i % 11, 'low': 60, 'high': 180},
             'actual': 100 + i % 11 + error} for i in range(count)]


class LocalCalibration(unittest.TestCase):
    def test_requires_out_of_time_evidence_and_improvement(self):
        self.assertEqual(train_calibration(samples(10))['status'], 'insufficient-data')
        result = train_calibration(samples())
        self.assertEqual(result['status'], 'validated')
        self.assertEqual(result['test']['candidateMAE'], 0)
        self.assertEqual(result['test']['baselineMAE'], 20)
        self.assertLess(result['split']['trainingLabelUntil'], result['split']['validationAsOf'])
        self.assertLess(result['split']['validationLabelUntil'], result['split']['testAsOf'])
        value = predict_calibration(result, {'point': 200, 'low': 150, 'high': 230})
        self.assertEqual(value['point'], 220)
        self.assertLessEqual(value['low'], value['point'])
        self.assertGreaterEqual(value['high'], value['point'])

    def test_drift_or_no_improvement_does_not_activate(self):
        self.assertEqual(train_calibration(samples(error=0))['status'], 'baseline')
        data = samples()
        for row in data[60:]:
            row['actual'] = row['features']['point'] - 20
        self.assertEqual(train_calibration(data)['status'], 'baseline')

    def test_overlapping_future_labels_and_bad_values_cannot_be_training(self):
        data = samples()
        for row in data:
            row['labelAt'] = 10**15
        self.assertEqual(train_calibration(data)['status'], 'insufficient-data')
        with self.assertRaises(ValueError):
            predict_calibration({'status': 'baseline'}, {'point': 2, 'low': 1, 'high': 3})


if __name__ == '__main__':
    unittest.main()
