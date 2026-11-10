// Tiny IndexedDB wrapper: one object store of documents keyed by "type:id".
// If IndexedDB is unavailable (private mode, embedded frames) it falls back to memory
// and reports `persistent: false` so the UI can say so instead of pretending.

const STORE = 'docs';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openDocs(name) {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    const db = await req(open);
    db.onversionchange = () => db.close();
    const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      persistent: true,
      all: () => req(tx('readonly').getAll()),
      put: (rec) => req(tx('readwrite').put(rec)),
      putMany(recs) {
        return new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const s = t.objectStore(STORE);
          for (const r of recs) s.put(r);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        });
      },
      delete: (key) => req(tx('readwrite').delete(key)),
      clear: () => req(tx('readwrite').clear()),
      close: () => db.close(),
    };
  } catch (err) {
    const mem = new Map();
    return {
      persistent: false,
      error: err,
      all: async () => [...mem.values()],
      put: async (rec) => { mem.set(rec.key, rec); },
      putMany: async (recs) => { for (const r of recs) mem.set(r.key, r); },
      delete: async (key) => { mem.delete(key); },
      clear: async () => { mem.clear(); },
      close() {},
    };
  }
}
