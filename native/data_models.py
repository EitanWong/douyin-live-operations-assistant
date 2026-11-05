"""Small local model with purged chronological validation and a sealed test.

This calibrates numeric forecasts only. It does not turn a heuristic PK score
into a calibrated probability, or claim a future accuracy guarantee.
"""
import math
from statistics import median


def nonoverlapping(rows):
    result, due = [], 0
    for row in sorted(rows, key=lambda r: (r['asOf'], r['id'])):
        if row['asOf'] >= due:
            result.append(row)
            due = row['dueAt']
    return result


def score(rows, shift, width):
    baseline = [abs(r['features']['point'] - r['actual']) for r in rows]
    error = [abs(max(0, r['features']['point'] + shift) - r['actual']) for r in rows]
    return {'samples': len(rows), 'baselineMAE': sum(baseline) / len(rows),
            'candidateMAE': sum(error) / len(rows),
            'coverage80': sum(e <= width for e in error) / len(rows)}


def improves(metrics):
    return metrics['baselineMAE'] > 0 and metrics['candidateMAE'] <= metrics['baselineMAE'] * .95


def train_calibration(rows):
    rows = nonoverlapping(rows)
    if len(rows) < 50:
        return {'status': 'insufficient-data', 'samples': len(rows), 'required': 50}
    a, b = int(len(rows) * .6), int(len(rows) * .8)
    training = [r for r in rows[:a] if r['labelAt'] < rows[a]['asOf']]
    validation = [r for r in rows[a:b] if r['labelAt'] < rows[b]['asOf']]
    test = rows[b:]
    if min(len(training), len(validation), len(test)) < 10:
        return {'status': 'insufficient-data', 'samples': len(rows), 'reason': '时间清洗后各段至少需要10个非重叠样本'}
    shift = median(r['actual'] - r['features']['point'] for r in training)
    residuals = sorted(abs(max(0, r['features']['point'] + shift) - r['actual']) for r in training)
    width = residuals[min(len(residuals) - 1, math.ceil((len(residuals) + 1) * .8) - 1)]
    val, final = score(validation, shift, width), score(test, shift, width)
    return {'status': 'validated' if improves(val) and improves(final) else 'baseline',
            'method': 'local-median-residual-v1', 'shift': shift, 'width': width,
            'samples': len(rows), 'validation': val, 'test': final,
            'trainingUntil': max(r['labelAt'] for r in rows),
            'split': {'trainingLabelUntil': max(r['labelAt'] for r in training),
                      'validationAsOf': validation[0]['asOf'],
                      'validationLabelUntil': max(r['labelAt'] for r in validation), 'testAsOf': test[0]['asOf']},
            'basis': '按时间隔离训练/验证/测试；两段MAE均改善至少5%才启用；80%区间覆盖率为留出集实测，非未来保证'}


def predict_calibration(model, row):
    if model.get('status') != 'validated':
        raise ValueError('模型未经留出集验证')
    values = [row.get(k) for k in ('point', 'low', 'high')]
    if not all(type(v) in (float, int) and math.isfinite(v) for v in values) or not 0 <= values[1] <= values[0] <= values[2]:
        raise ValueError('预测输入无效')
    point = max(0, row['point'] + model['shift'])
    return {'point': point, 'low': max(0, point - model['width']), 'high': point + model['width'],
            'method': model['method'], 'calibration': 'temporal-holdout', 'test': model['test'],
            'basis': model['basis']}
