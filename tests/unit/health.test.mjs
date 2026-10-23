import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUnacknowledgedRuntimeAlert, reconcileRuntimeAlertState, runtimeAlertState } from '../../src/runtime/health.js';

test('采集缺口确认后不重复提示，新缺口会重新提示',()=>{
  const first={ingestion:{gaps:2},bridgeGaps:1,frameGaps:0,capture:{gaps:3}};
  const acknowledged=runtimeAlertState(first);
  assert.equal(hasUnacknowledgedRuntimeAlert(first,acknowledged),false);
  assert.equal(hasUnacknowledgedRuntimeAlert({...first,ingestion:{gaps:3}},acknowledged),true);
});

test('已确认的阻塞/存储告警恢复后再次发生会重新提示',()=>{
  const blocked={ingestion:{blocked:true,quarantined:2,gaps:1},storage:{ratio:.9}};
  const acknowledged=runtimeAlertState(blocked);
  assert.equal(hasUnacknowledgedRuntimeAlert(blocked,acknowledged),false);
  const recovered={ingestion:{blocked:false,quarantined:0,gaps:1},storage:{ratio:.7}};
  const afterRecovery=reconcileRuntimeAlertState(recovered,acknowledged);
  assert.equal(hasUnacknowledgedRuntimeAlert(recovered,afterRecovery),false);
  assert.equal(hasUnacknowledgedRuntimeAlert({...recovered,ingestion:{...recovered.ingestion,blocked:true}},afterRecovery),true);
  assert.equal(hasUnacknowledgedRuntimeAlert({...recovered,storage:{ratio:.85}},afterRecovery),true);
});

test('采集计数重置后按新的计数重新判断，不沿用旧确认水位',()=>{
  const old={ingestion:{gaps:8}};
  const acknowledged=runtimeAlertState(old);
  const current={ingestion:{gaps:1}};
  const reconciled=reconcileRuntimeAlertState(current,acknowledged);
  assert.equal(reconciled.gaps.events,1);
  assert.equal(hasUnacknowledgedRuntimeAlert(current,reconciled),false);
});
