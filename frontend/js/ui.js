// Shared UI helpers: event bus, formatting, toasts, sheets, rows.

// ── Event bus ────────────────────────────────────────────────────────
const target = new EventTarget();
export const bus = {
  on(name, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(name, h);
    return () => target.removeEventListener(name, h);
  },
  emit(name, detail) {
    target.dispatchEvent(new CustomEvent(name, { detail }));
  },
};

// ── DOM ──────────────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// ── Money ────────────────────────────────────────────────────────────
const pesoFmt = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 });

/** ₱12,345.67 · sign: '+'/'−' prefix · compact: ₱12.3K */
export function money(n, { sign = false, compact = false } = {}) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const body = compact && abs >= 10000 ? compactFmt.format(abs) : pesoFmt.format(abs);
  const s = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${s}₱${body}`;
}

/** Split for display: { sign, whole, cents } */
export function moneyParts(n) {
  const v = Number(n) || 0;
  const [whole, cents] = pesoFmt.format(Math.abs(v)).split('.');
  return { sign: v < 0 ? '−' : '', whole, cents };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function signedAmount(t) {
  if (t.type === 'Income') return t.amount;
  if (t.type === 'Expense') return -t.amount;
  return 0;
}

// ── Dates (local time; the phone is in Asia/Manila) ──────────────────
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
export function dayLabel(s) {
  const today = todayStr();
  if (s === today) return 'Today';
  if (s === addDays(today, -1)) return 'Yesterday';
  const d = parseYmd(s);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-PH', opts);
}
export function shortDate(s) {
  const d = parseYmd(s);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-PH', opts);
}
export function monthLabel(ym, style = 'long') {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  if (style === 'short') return d.toLocaleDateString('en-PH', { month: 'short' });
  if (style === 'shortYear') return d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}
export function timeAgo(iso) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Colors ───────────────────────────────────────────────────────────
const PALETTE = ['#E4572E', '#4F5BD5', '#17A398', '#F5B82E', '#B14AED', '#EF476F', '#3A86FF', '#FB8500', '#2A9D8F', '#8D6E63', '#6A994E', '#D1495B'];
export function hashColor(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
/** Readable text color (ink or white) for a hex background. */
export function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? '#14161A' : '#FFFFFF';
}

// ── Errors ───────────────────────────────────────────────────────────
const FRIENDLY = {
  OFFLINE: "You're offline. This needs a connection.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
  TIMEOUT: 'The server took too long to answer. Try again.',
  HTTP: 'The server had a problem. Try again in a moment.',
  BAD_RESPONSE: 'The server sent an unexpected reply. Check API_URL in config.js.',
  SERVER_ERROR: 'Something went wrong on the server. Try again.',
  BUSY: 'The sheet is busy. Try again in a moment.',
  INTERACTION_REQUIRED: 'Your session paused. Tap “Continue” to sign in again.',
  AUTH_REQUIRED: 'Please sign in.',
  AUTH_EXPIRED: 'Your session expired. Please sign in again.',
  AUTH_DENIED: 'This Google account is not allowed to use this app.',
  AUTH_UNAVAILABLE: 'Could not verify your sign-in right now. Try again.',
  SERVER_NOT_CONFIGURED: 'The backend is not set up yet (see SETUP.md, step 1).',
  GIS_UNAVAILABLE: "Google sign-in couldn't load. Check your connection.",
  UNKNOWN_ACTION: 'The backend is out of date. Redeploy the Apps Script (SETUP.md, step 9).',
};
/** Human message for any error. Validation messages from the server are already friendly. */
export function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  if (['VALIDATION', 'CONFLICT', 'NOT_FOUND'].includes(err.code) && err.message) return err.message;
  return FRIENDLY[err.code] || 'Something went wrong. Try again.';
}

// ── Toasts ───────────────────────────────────────────────────────────
export function toast(message, { type = 'info', action, onAction, duration = 3200 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = type === 'ok' ? 'check' : type === 'error' ? 'alert' : type === 'offline' ? 'cloud-off' : 'info';
  el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>${action ? `<button type="button" class="toast-act">${esc(action)}</button>` : ''}`;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    el.querySelector('.toast-act').addEventListener('click', () => {
      onAction?.();
      close();
    });
  }
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, action ? duration + 2500 : duration);
}

// ── Sheets & dialogs (one <dialog>, bottom sheet on phones) ──────────
let openDialog = null;
/**
 * Opens a modal sheet. `body` is an HTML string. Returns { el, close, done }.
 * `done` resolves with the value passed to close().
 */
export function sheet({ title, body, className = '', onOpen }) {
  if (openDialog) openDialog.close(undefined);
  const dlg = document.createElement('dialog');
  dlg.className = `sheet ${className}`;
  dlg.innerHTML = `
    <div class="sheet-card" role="document">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2>${esc(title || '')}</h2>
        <button type="button" class="icon-btn sheet-x" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.append(dlg);
  let resolve;
  const done = new Promise((r) => (resolve = r));
  let result;
  let finished = false;
  let closing = false;
  // Resolves directly instead of waiting for the dialog's "close" event,
  // which some browsers deliver late (or not at all) in background tabs.
  const finish = () => {
    if (finished) return;
    finished = true;
    if (openDialog === api) openDialog = null;
    if (dlg.open) dlg.close();
    dlg.remove();
    resolve(result);
  };
  const api = {
    el: dlg,
    done,
    close(value) {
      if (closing || finished) return;
      closing = true;
      result = value;
      if (dlg.open && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dlg.classList.add('closing');
        setTimeout(finish, 180);
      } else finish();
    },
  };
  dlg.addEventListener('close', () => {
    if (!closing) result = undefined;
    finish();
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    api.close(undefined);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) api.close(undefined);
  });
  dlg.querySelector('.sheet-x').addEventListener('click', () => api.close(undefined));
  openDialog = api;
  dlg.showModal();
  onOpen?.(dlg, api);
  return api;
}

export function closeSheet() {
  openDialog?.close(undefined);
}

export async function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  const s = sheet({
    title,
    className: 'sheet-confirm',
    body: `<p class="muted">${esc(message || '')}</p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-v="0">Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${esc(confirmText)}</button>
      </div>`,
    onOpen: (el, api) => {
      el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => api.close(b.dataset.v === '1')));
      el.querySelector('[data-v="1"]').focus();
    },
  });
  return (await s.done) === true;
}

// ── Transaction row ──────────────────────────────────────────────────
/**
 * @param t transaction
 * @param opts.cats Map name → category
 * @param opts.wallets Map name → wallet
 */
export function txnRow(t, { cats, wallets, showDate = false } = {}) {
  const cat = cats?.get(t.category);
  const isT = t.type === 'Transfer';
  const tint = isT ? 'var(--transfer)' : cat ? hashColor(cat.name) : t.type === 'Income' ? 'var(--income)' : 'var(--ink-3)';
  const glyph = isT ? icon('swap') : `<span class="emoji">${esc(cat?.icon || (t.type === 'Income' ? '💰' : '🏷️'))}</span>`;
  const route = isT ? `${esc(t.wallet)} → ${esc(t.toWallet || '…')}` : esc(t.wallet);
  const title = t.note ? esc(firstLine(t.note)) : esc(isT ? 'Transfer' : t.category || t.type);
  const bits = [route];
  if (t.note && !isT && t.category) bits.push(esc(t.category));
  if (showDate) bits.push(esc(shortDate(t.date)));
  const cls = t.type === 'Income' ? 'amt-in' : t.type === 'Expense' ? 'amt-out' : 'amt-trf';
  const amt = t.type === 'Income' ? money(t.amount, { sign: true }) : t.type === 'Expense' ? money(-t.amount) : money(t.amount);
  const wc = wallets?.get(t.wallet)?.color;
  const flags = [
    t._unsynced ? `<span class="flag flag-sync" title="Not synced yet">${icon('cloud-off')}</span>` : '',
    t.status === 'Pending' ? '<span class="flag flag-pending">Pending</span>' : '',
    t.originalCurrency && t.originalCurrency !== 'PHP' ? `<span class="flag">${esc(t.originalCurrency)}</span>` : '',
  ].join('');
  return `
    <button type="button" class="txn" data-id="${esc(t.id)}">
      <span class="txn-ic" style="--tint:${tint}">${glyph}</span>
      <span class="txn-main">
        <span class="txn-title">${title}</span>
        <span class="txn-sub">${wc ? `<i class="dot" style="background:${esc(wc)}"></i>` : ''}${bits.join(' · ')}</span>
      </span>
      <span class="txn-right">
        <span class="txn-amt ${cls}">${amt}</span>
        ${flags ? `<span class="txn-flags">${flags}</span>` : ''}
      </span>
    </button>`;
}

function firstLine(s) {
  const line = String(s).split('\n')[0];
  return line.length > 80 ? `${line.slice(0, 78)}…` : line;
}

export function emptyState({ title, text, iconName = 'sparkle', action = '' }) {
  return `<div class="empty">
    <div class="empty-ic">${icon(iconName)}</div>
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${action}
  </div>`;
}

export function skeletonRows(n = 5) {
  return Array.from({ length: n }, () => `
    <div class="txn skel-row" aria-hidden="true">
      <span class="skel skel-circle"></span>
      <span class="txn-main"><span class="skel skel-line w60"></span><span class="skel skel-line w40"></span></span>
      <span class="skel skel-line w20"></span>
    </div>`).join('');
}

/** Copies text; returns true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
