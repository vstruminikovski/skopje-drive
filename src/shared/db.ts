// The app's small key-value store. IndexedDB (large, not a plain string); localStorage only where IndexedDB is missing.
// One mode is chosen on first use and kept, so a value is never read from one store after it was written to the other.

const DB = 'skopje-drive';
const STORE = 'kv';

let mode: 'idb' | 'ls' | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not open'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another window'));
  });
  return dbPromise;
}

async function currentMode(): Promise<'idb' | 'ls'> {
  if (mode) return mode;
  try { await openDb(); mode = 'idb'; } catch { mode = 'ls'; }
  return mode;
}

/** The value stored under key, or null. */
export async function kvGet<T>(key: string): Promise<T | null> {
  if ((await currentMode()) === 'ls') {
    try { const raw = localStorage.getItem(`kv:${key}`); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  }
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error ?? new Error('read failed'));
  });
}

/** Stores value under key. Throws if it could not be kept, so the caller can tell the player. */
export async function kvSet(key: string, value: unknown): Promise<void> {
  if ((await currentMode()) === 'ls') {
    localStorage.setItem(`kv:${key}`, JSON.stringify(value));
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
  });
}

/** Removes the value under key. */
export async function kvDel(key: string): Promise<void> {
  if ((await currentMode()) === 'ls') { localStorage.removeItem(`kv:${key}`); return; }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
  });
}
