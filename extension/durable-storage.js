const DB_NAME = 'douyin-live-assistant';
const DB_VERSION = 1;
const STORE_NAME = 'records';
export const isDurableKey = key => /^(live-assistant:(config|runtime|income|income-calibration|profile|event|rewards|api-key|search-key|media-key):|douyin-live-assistant:theme$)/.test(key);
const categoryOf = key => /^live-assistant:(income|income-calibration|profile):/.test(key) ? 'income' : key.startsWith('live-assistant:event:') ? 'pending' : key.startsWith('live-assistant:runtime:') ? 'runtime' : 'settings';
const encodedSize = (key,value) => new TextEncoder().encode(key + JSON.stringify(value)).byteLength;

// Only the extension worker opens this database. Each write resolves after its
// transaction commits, including the usage counters; a request success is not a commit.
export class DurableStorage {
  constructor({ indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, IDBKeyRange = keyRange, local }) {
    this.indexedDB = indexedDB; this.keyRange = IDBKeyRange; this.local = local;
    this.dbPromise = null; this.tail = Promise.resolve();
  }
  open() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const records = request.result.createObjectStore(STORE_NAME, {keyPath:'key'});
          records.createIndex('journalOrder',['room','savedAt','key']);
          request.result.createObjectStore('metadata');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.dbPromise = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('账本数据库打开失败'));
        request.onblocked = () => reject(new Error('账本数据库正在升级，请关闭其他直播助手页面后重试'));
      });
      void this.dbPromise.catch(()=>{this.dbPromise=null;});
    }
    return this.dbPromise;
  }
  transaction(mode, work) {
    const previous = this.tail;
    const task = (async () => {
      try { await previous; } catch {}
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME,'metadata'], mode);
        let result = () => undefined;
        tx.oncomplete = () => resolve(result());
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('账本数据库事务失败'));
        try { result = work(tx.objectStore(STORE_NAME),tx.objectStore('metadata')) || result; }
        catch (error) { tx.abort(); reject(error); }
      });
    })();
    this.tail = task;
    return task;
  }
  get(key) {
    return this.transaction('readonly', store => {
      const request = store.get(key);
      return () => request.result?.value;
    });
  }
  getAll(prefixes = ['']) {
    return this.transaction('readonly', store => {
      const requests = prefixes.map(prefix=>store.getAll(this.keyRange.bound(prefix,`${prefix}\uffff`)));
      return () => Object.fromEntries(requests.flatMap(request=>request.result.map(entry=>[entry.key,entry.value])));
    });
  }
  listEvents(room, after, limit = 256) {
    return this.transaction('readonly', store => {
      const low = [room,Number(after?.savedAt) || 0,String(after?.key || '')];
      const high = [room,Number.MAX_SAFE_INTEGER,'\uffff'];
      const request = store.index('journalOrder').getAll(this.keyRange.bound(low,high,Boolean(after)),limit);
      return () => request.result.map(entry=>({key:entry.key,...entry.value}));
    });
  }
  putRecords(records, onlyAbsent = false) {
    return this.transaction('readwrite', (store,metadata) => {
      const statsRequest = metadata.get('usage');
      statsRequest.onsuccess = () => {
        const stats = statsRequest.result || {};
        for (const [key,value] of records) {
          const previous = store.get(key);
          previous.onsuccess = () => {
            if (onlyAbsent && previous.result) return;
            const category = categoryOf(key), bytes = encodedSize(key,value);
            const bucket = stats[category] ||= {bytes:0,count:0};
            bucket.bytes += bytes - (previous.result?.bytes || 0);
            if (!previous.result) bucket.count++;
            const room = key.match(/^live-assistant:event:(\d+):/)?.[1];
            store.put({key,value,category,bytes,...(room ? {room,savedAt:Number(value.savedAt) || 0} : {})});
            metadata.put(stats,'usage');
          };
        }
      };
    });
  }
  set(key,value) { return this.putRecords([[key,value]]); }
  remove(keys) {
    return this.transaction('readwrite', (store,metadata) => {
      const statsRequest = metadata.get('usage');
      statsRequest.onsuccess = () => {
        const stats = statsRequest.result || {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          const previous = store.get(key);
          previous.onsuccess = () => {
            if (!previous.result) return;
            const bucket = stats[previous.result.category];
            bucket.bytes -= previous.result.bytes; bucket.count--;
            store.delete(key); metadata.put(stats,'usage');
          };
        }
      };
    });
  }
  usage() {
    return this.transaction('readonly', (_store,metadata) => {
      const request = metadata.get('usage');
      return () => ({backend:'indexeddb',categories:request.result || {},measurement:'json-utf8'});
    });
  }
  async migrate() {
    const records = Object.entries(await this.local.get(null)).filter(([key])=>isDurableKey(key));
    if (!records.length) return 0;
    // One atomic copy. Repeating after an interrupted removal never overwrites a
    // committed database value. Conflicting copies require recovery, not guessing.
    await this.putRecords(records,true);
    const migrated = await this.getAll();
    if (records.some(([key,value])=>JSON.stringify(migrated[key]) !== JSON.stringify(value))) throw new Error('旧数据迁移校验失败，原数据已保留');
    await this.local.remove(records.map(([key])=>key));
    return records.length;
  }
}
