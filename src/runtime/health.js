const healthCount = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function runtimeAlertState(network = {}) {
  const ingestion = network.ingestion || {}, storage = network.storage || {};
  return {
    contextInvalidated:Boolean(network.contextInvalidated),
    blocked:Boolean(ingestion.blocked),
    quarantined:healthCount(ingestion.quarantined),
    gaps:{
      events:healthCount(ingestion.gaps),
      bridge:healthCount(network.bridgeGaps),
      frames:healthCount(network.frameGaps),
      capture:healthCount(network.capture?.gaps)
    },
    storageHigh:healthCount(storage.ratio) >= 0.8
  };
}

export function normalizeRuntimeAlertState(state = {}) {
  return {
    contextInvalidated:Boolean(state.contextInvalidated),
    blocked:Boolean(state.blocked),
    quarantined:healthCount(state.quarantined),
    gaps:{
      events:healthCount(state.gaps?.events),
      bridge:healthCount(state.gaps?.bridge),
      frames:healthCount(state.gaps?.frames),
      capture:healthCount(state.gaps?.capture)
    },
    storageHigh:Boolean(state.storageHigh)
  };
}

export function hasUnacknowledgedRuntimeAlert(network = {}, acknowledged = {}) {
  const current = runtimeAlertState(network), known = normalizeRuntimeAlertState(acknowledged);
  return current.contextInvalidated && !known.contextInvalidated
    || current.blocked && !known.blocked
    || current.quarantined > known.quarantined
    || Object.keys(current.gaps).some(key=>current.gaps[key] > known.gaps[key])
    || current.storageHigh && !known.storageHigh;
}

export function reconcileRuntimeAlertState(network = {}, acknowledged = {}) {
  const current = runtimeAlertState(network), known = normalizeRuntimeAlertState(acknowledged);
  return {
    contextInvalidated:current.contextInvalidated ? known.contextInvalidated : false,
    blocked:current.blocked ? known.blocked : false,
    quarantined:current.quarantined ? known.quarantined : 0,
    gaps:Object.fromEntries(Object.keys(current.gaps).map(key=>[key,Math.min(current.gaps[key],known.gaps[key])])),
    storageHigh:current.storageHigh ? known.storageHigh : false
  };
}
