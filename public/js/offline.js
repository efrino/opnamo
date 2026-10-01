// Offline-first scan queue (IndexedDB) + per-stocktake catalog cache.
import { api } from './api.js';

const DB = 'opnamo', VER = 1;
let dbp;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('queue', { keyPath: 'client_id' });
      r.result.createObjectStore('catalog', { keyPath: 'id' });
      r.result.createObjectStore('failed', { keyPath: 'client_id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function store(name, mode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const queueAll = async () => req((await store('queue')).getAll());
export const failedAll = async () => req((await store('failed')).getAll());
export const clearFailed = async () => req((await store('failed', 'readwrite')).clear());

// randomUUID only exists in secure contexts; fall back to getRandomValues (RFC 4122 v4).
export const uuid = () => crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export async function enqueue(entry) {
  const e = { client_id: uuid(), counted_at: new Date().toISOString(), ...entry };
  await req((await store('queue', 'readwrite')).put(e));
  sync();
  return e;
}

export async function saveCatalog(id, data) { await req((await store('catalog', 'readwrite')).put({ id, ...data })); }
export async function getCatalog(id) { return req((await store('catalog')).get(id)); }

// Push queued entries, grouped per stocktake. Safe to call often: server dedupes by client_id.
let syncing = null;
const listeners = new Set();
export const onSync = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function sync() {
  if (syncing || !navigator.onLine) return syncing;
  syncing = (async () => {
    try {
      const all = await queueAll();
      const groups = Map.groupBy ? Map.groupBy(all, e => e.stocktake_id) : all.reduce((m, e) => m.set(e.stocktake_id, [...(m.get(e.stocktake_id) || []), e]), new Map());
      for (const [sid, list] of groups) {
        for (let i = 0; i < list.length; i += 200) {
          const batch = list.slice(i, i + 200);
          let r;
          try { r = await api(`/stocktakes/${sid}/entries`, { method: 'POST', body: { entries: batch.map(({ stocktake_id, label, ...e }) => e) } }); }
          catch (err) {
            // Closed or deleted stocktake: park entries as failed so they don't block the queue.
            if (err.status === 409 || err.status === 404) r = { accepted: [], rejected: batch.map(e => ({ client_id: e.client_id, error: err.message })) };
            else throw err;
          }
          const q = await store('queue', 'readwrite');
          r.accepted.forEach(id => q.delete(id));
          if (r.rejected.length) {
            const f = await store('failed', 'readwrite');
            for (const x of r.rejected) { const e = batch.find(b => b.client_id === x.client_id); if (e) f.put({ ...e, error: x.error }); }
            const q2 = await store('queue', 'readwrite'); r.rejected.forEach(x => q2.delete(x.client_id));
          }
        }
      }
    } catch { /* network error: retry later */ }
    finally { syncing = null; listeners.forEach(fn => fn()); }
  })();
  return syncing;
}
addEventListener('online', () => sync());
setInterval(() => sync(), 20000);
