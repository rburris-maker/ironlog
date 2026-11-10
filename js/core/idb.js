// Tiny IndexedDB wrapper: one object store of documents keyed by "type:id".
// If IndexedDB is unavailable (private mode, embedded frames) it falls back to memory
// and reports `persistent: false` so the UI can say so instead of pretending.

const STORE = 'docs';

// Some browsers (notably iOS) can leave an IndexedDB request pending forever.
// Every request therefore has a deadline, so the app can fall back instead of freezing.
const DEADLINE_MS = 5000;

function req(r, ms = DEADLINE_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB did not respond')), ms);
    r.onsuccess = () => { clearTimeout(timer); resolve(r.result); };
    r.onerror = () => { clearTimeout(timer); reject(r.error); };
    r.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB is blocked')); };
  });
}

export async function openDocs(name) {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    let abandoned = false;
    open.addEventListener('success', () => { if (abandoned) { try { open.result.close(); } catch { /* ignore */ } } });
    let db;
    try { db = await req(open, 4000); } catch (e) { abandoned = true; throw e; }
    db.onversionchange = () => db.close();
    const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      persistent: true,
      all: () => req(tx('readonly').getAll()),
      put: (rec) => req(tx('readwrite').put(rec)),
      putMany(recs) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('IndexedDB did not respond')), DEADLINE_MS);
          const t = db.transaction(STORE, 'readwrite');
          const s = t.objectStore(STORE);
          for (const r of recs) s.put(r);
          t.oncomplete = () => { clearTimeout(timer); resolve(); };
          t.onerror = () => { clearTimeout(timer); reject(t.error); };
          t.onabort = () => { clearTimeout(timer); reject(t.error); };
        });
      },
      delete: (key) => req(tx('readwrite').delete(key)),
      clear: () => req(tx('readwrite').clear()),
      close: () => db.close(),
    };
  } catch (err) {
    return memoryDocs(err);
  }
}

/** In-memory stand-in used when the browser's storage is unavailable or unresponsive. */
export function memoryDocs(err) {
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
