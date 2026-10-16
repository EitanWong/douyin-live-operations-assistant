// A request is processed in a later task, as in the browser's Web Locks API.
export function webLocks() {
  const held = new Set();
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => setTimeout(async () => {
        if (held.has(name)) { try { resolve(await callback(null)); } catch (e) { reject(e); } return; }
        held.add(name);
        try { resolve(await callback({name})); } catch (e) { reject(e); }
        finally { held.delete(name); }
      }, 0));
    }
  };
}
