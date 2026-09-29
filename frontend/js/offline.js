// IndexedDB: a key/value cache (for offline viewing) and the write queue.
// Every add/edit/delete goes through the queue first, online or not, so the
// same code path handles both. The queue is flushed with the backend's bulkAdd
// action; entry IDs come from the device, so retries never create duplicates.
import { api } from './api.js';
import { bus } from './ui.js';

const DB_NAME = 'budget-pwa';
const DB_VERSION = 1;
let dbPromise = null;
let memory = null; // fallback when IndexedDB is unavailable (e.g. some private modes)

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    memory = { kv: new Map(), queue: new Map() };
    throw e;
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    if (!memory) throw e;
    return runMemory(store, fn);
  }
}

function runMemory(store, fn) {
  const m = memory[store];
  const fake = {
    get: (k) => ({ result: m.get(k) }),
    getAll: () => ({ result: [...m.values()] }),
    put: (v, k) => (m.set(k ?? v.id, v), { result: k }),
    delete: (k) => (m.delete(k), { result: undefined }),
    clear: () => (m.clear(), { result: undefined }),
    count: () => ({ result: m.size }),
  };
  const r = fn(fake);
  return r ? r.result : undefined;
}

// ── Key/value cache ──────────────────────────────────────────────────
export const kvGet = (k) => run('kv', 'readonly', (s) => s.get(k)).catch(() => undefined);
export const kvSet = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)).catch(() => undefined);
export const kvClear = () => run('kv', 'readwrite', (s) => s.clear()).catch(() => undefined);

// ── Queue ────────────────────────────────────────────────────────────
const qAll = () => run('queue', 'readonly', (s) => s.getAll()).catch(() => []);
const qGet = (id) => run('queue', 'readonly', (s) => s.get(id)).catch(() => undefined);
const qPut = (item) => run('queue', 'readwrite', (s) => s.put(item));
const qDel = (id) => run('queue', 'readwrite', (s) => s.delete(id));

export async function queueItems() {
  const items = (await qAll()) || [];
  return items.sort((a, b) => a.queuedAt - b.queuedAt);
}

async function notify() {
  const items = await queueItems();
  bus.emit('queue', { count: items.length, errors: items.filter((i) => i.error).length, items });
  return items;
}
export const refreshQueueState = notify;

/**
 * Queues a change. Coalesces with anything already queued for the same entry:
 *   add + update  → add (with new data)
 *   add + delete  → nothing (it never reached the server)
 */
export async function enqueue(op, txn) {
  const id = txn.id;
  const existing = await qGet(id);
  const now = Date.now();
  let item;
  if (op === 'delete') {
    if (existing && existing.op === 'add') {
      await qDel(id);
      await notify();
      return;
    }
    item = { id, op: 'delete', txn, queuedAt: existing?.queuedAt || now, rev: (existing?.rev || 0) + 1, error: null };
  } else if (op === 'update' && existing && existing.op === 'add') {
    item = { ...existing, txn, rev: existing.rev + 1, error: null };
  } else {
    item = { id, op, txn, queuedAt: existing?.queuedAt || now, rev: (existing?.rev || 0) + 1, error: null };
  }
  await qPut(item);
  await notify();
  scheduleFlush(300);
}

export async function discardQueued(id) {
  await qDel(id);
  await notify();
}

export async function retryQueued() {
  const items = await queueItems();
  for (const it of items) if (it.error) await qPut({ ...it, error: null });
  await notify();
  return flushQueue();
}

let flushing = null;
let flushTimer = null;
export function scheduleFlush(ms = 0) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushQueue().catch(() => {}), ms);
}

/** Sends queued changes. Resolves to { synced, failed, error? }. */
export function flushQueue() {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush() {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const items = (await queueItems()).filter((i) => !i.error);
  if (!items.length) return { synced: 0, failed: 0 };
  bus.emit('syncing', true);
  let synced = 0;
  let failed = 0;
  try {
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      const res = await api('bulkAdd', {
        items: chunk.map((it) => ({ op: it.op, id: it.id, txn: it.op === 'delete' ? undefined : it.txn })),
      });
      for (const r of res.results || []) {
        const sent = chunk.find((c) => c.id === r.id);
        if (!sent) continue;
        const current = await qGet(r.id);
        const unchanged = current && current.rev === sent.rev;
        const gone = r.status === 'error' && r.error === 'NOT_FOUND' && sent.op !== 'add';
        if (r.status === 'ok' || r.status === 'duplicate' || gone) {
          if (unchanged) await qDel(r.id);
          synced++;
        } else if (r.status === 'error') {
          failed++;
          if (unchanged) await qPut({ ...current, error: r.message || 'Could not sync this entry.' });
        }
      }
    }
    return { synced, failed };
  } catch (err) {
    return { synced, failed, error: err };
  } finally {
    bus.emit('syncing', false);
    await notify();
    if (synced) bus.emit('synced', { synced });
  }
}

/**
 * Overlays queued changes on a list from the server (for optimistic UI).
 * Adds are only included when `includeAdds` is true.
 */
export function overlay(list, queue, { includeAdds = false, filter = () => true } = {}) {
  const byId = new Map(queue.map((q) => [q.id, q]));
  const out = [];
  for (const t of list) {
    const q = byId.get(t.id);
    if (!q) out.push(t);
    else if (q.op === 'delete') continue;
    else if (filter(q.txn)) out.push({ ...q.txn, _unsynced: true });
  }
  if (includeAdds) {
    const have = new Set(list.map((t) => t.id));
    for (const q of queue) {
      if (q.op === 'add' && !have.has(q.id) && filter(q.txn)) out.push({ ...q.txn, _unsynced: true });
    }
  }
  return out;
}
