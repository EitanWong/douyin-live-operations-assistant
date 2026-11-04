// View snapshots contain plain records/arrays and opaque leaf values (including
// chart formatters). Do not serialize: JSON erases functions and retains a second
// copy of large chart data. Controllers keep ownership of the supplied objects.
export function shareView(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let result = previous.length === next.length ? null : next.slice();
    for (let i = 0; i < next.length; i++) {
      const value = shareView(previous[i], next[i]);
      if (!result && !Object.is(value, previous[i])) result = previous.slice();
      if (result) result[i] = value;
    }
    return result || previous;
  }
  if (Object.getPrototypeOf(next) !== Object.prototype || Object.getPrototypeOf(previous) !== Object.prototype) return next;
  const keys = Object.keys(next);
  let result = keys.length !== Object.keys(previous).length || keys.some(key => !Object.hasOwn(previous, key)) ? {...next} : null;
  for (const key of keys) {
    const value = shareView(previous[key], next[key]);
    if (!result && !Object.is(value, previous[key])) result = {...previous};
    if (result) result[key] = value;
  }
  return result || previous;
}
