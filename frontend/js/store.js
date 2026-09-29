// App state shared by pages.
import { api } from './api.js';
import { kvGet, kvSet } from './offline.js';
import { bus, toast, friendlyError } from './ui.js';

export const state = {
  user: null,
  boot: null, // { wallets, categories, settings, totalBalance, pendingCount, sheetUrl, ... }
  dash: null,
  queue: { count: 0, errors: 0, items: [] },
  online: navigator.onLine,
  syncing: false,
};

// Entries seen recently, so the edit page can open one without refetching.
const known = new Map();
export function remember(list) {
  for (const t of list || []) if (t && t.id) known.set(t.id, t);
}
export function knownTxn(id) {
  return known.get(id) || state.queue.items.find((q) => q.id === id)?.txn || null;
}

export async function hydrate() {
  const [boot, dash] = await Promise.all([kvGet('bootstrap'), kvGet('dashboard')]);
  if (boot) state.boot = boot;
  if (dash) {
    state.dash = dash;
    remember(dash.recent);
  }
}

export async function loadBootstrap({ silent = true } = {}) {
  try {
    const data = await api('getBootstrap');
    setBoot(data);
    return data;
  } catch (err) {
    handleError(err, { silent });
    return null;
  }
}

export function setBoot(data) {
  state.boot = { ...(state.boot || {}), ...data };
  kvSet('bootstrap', state.boot);
  bus.emit('boot', state.boot);
}

export function setPendingCount(n) {
  if (!state.boot) return;
  state.boot.pendingCount = n;
  kvSet('bootstrap', state.boot);
  bus.emit('boot', state.boot);
}

export function wallets({ includeArchived = false } = {}) {
  const list = state.boot?.wallets || [];
  return includeArchived ? list : list.filter((w) => !w.archived);
}

export function categories(type) {
  const list = (state.boot?.categories || []).filter((c) => !c.archived);
  if (!type) return list;
  return list.filter((c) => c.type === type || c.type === 'Both');
}

export const walletMap = () => new Map((state.boot?.wallets || []).map((w) => [w.name, w]));
export const categoryMap = () => new Map((state.boot?.categories || []).map((c) => [c.name, c]));

/**
 * Central error handling: session problems raise the re-auth banner, a denied
 * account signs out, everything else becomes a friendly toast (unless silent).
 */
export function handleError(err, { silent = false } = {}) {
  const code = err?.code;
  if (code === 'INTERACTION_REQUIRED' || code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') {
    bus.emit('reauth-needed');
    return;
  }
  if (code === 'AUTH_DENIED') {
    bus.emit('auth-denied');
    return;
  }
  if (code === 'OFFLINE' && silent) return;
  if (!silent) toast(friendlyError(err), { type: code === 'OFFLINE' ? 'offline' : 'error' });
}

// One-shot handoff of an entry between pages (e.g. Review → Edit).
let handoff = null;
export function setHandoff(v) {
  handoff = v;
}
export function takeHandoff() {
  const v = handoff;
  handoff = null;
  return v;
}
