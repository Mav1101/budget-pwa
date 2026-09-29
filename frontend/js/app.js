// App shell: boot sequence, hash router, navigation, status indicators.
import { CONFIG } from './config.js';
import * as auth from './auth.js';
import { state, hydrate, loadBootstrap, handleError } from './store.js';
import { flushQueue, refreshQueueState, scheduleFlush, queueItems, discardQueued, retryQueued, kvClear } from './offline.js';
import { bus, $, $$, esc, icon, toast, sheet, closeSheet, confirmDialog, money } from './ui.js';
import { applyTheme, isDark, setThemeMode, themeMode } from './theme.js';

import signin from './pages/signin.js';
import dashboard from './pages/dashboard.js';
import entry from './pages/add.js';
import transactions from './pages/transactions.js';
import review from './pages/review.js';
import reports from './pages/reports.js';
import settings from './pages/settings.js';

const ROUTES = [
  { path: '/', page: dashboard, title: 'Home', nav: 'dashboard' },
  { path: '/transactions', page: transactions, title: 'Transactions', nav: 'transactions' },
  { path: '/add', page: entry, title: 'New entry', nav: 'add' },
  { path: '/edit/:id', page: entry, title: 'Edit entry', nav: 'transactions' },
  { path: '/review', page: review, title: 'Review', nav: 'review' },
  { path: '/reports', page: reports, title: 'Reports', nav: 'reports' },
  { path: '/settings', page: settings, title: 'Settings', nav: 'settings' },
  { path: '/signin', page: signin, title: 'Sign in', bare: true },
].map((r) => {
  const keys = [];
  const re = new RegExp(`^${r.path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
  return { ...r, re, keys };
});

let current = { cleanup: [], token: 0 };

export function go(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (location.hash === hash) {
    render();
    return;
  }
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else location.hash = hash;
}

function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1)) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function render() {
  const { path, query } = parseHash();
  let route = ROUTES.find((r) => r.re.test(path));
  let params = {};
  if (!route) {
    go('/', { replace: true });
    return;
  }
  if (!state.user && route.path !== '/signin') {
    go('/signin', { replace: true });
    return;
  }
  if (state.user && route.path === '/signin') {
    go('/', { replace: true });
    return;
  }
  const m = route.re.exec(path);
  route.keys.forEach((k, i) => (params[k] = m[i + 1]));

  current.cleanup.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  const token = ++current.token;
  current = { cleanup: [], token };
  closeSheet();

  document.body.classList.toggle('is-bare', !!route.bare);
  document.title = route.bare ? 'Budget' : `${route.title} · Budget`;
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === route.nav || (a.dataset.navAlt || '').split(' ').includes(route.nav);
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#page-title').textContent = route.bare ? '' : route.title;

  const view = $('#view');
  view.innerHTML = '';
  view.classList.remove('page-enter');
  void view.offsetWidth;
  view.classList.add('page-enter');
  window.scrollTo({ top: 0 });

  const ctx = {
    params,
    query,
    go,
    isCurrent: () => current.token === token,
    on(name, fn) {
      current.cleanup.push(bus.on(name, fn));
    },
    onCleanup(fn) {
      current.cleanup.push(fn);
    },
    setQuery(q) {
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v != null)).toString();
      history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
    },
  };
  try {
    const cleanup = await route.page.mount(view, ctx);
    if (typeof cleanup === 'function') {
      if (current.token === token) current.cleanup.push(cleanup);
      else cleanup();
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="empty"><div class="empty-ic">${icon('alert')}</div><h3>This page couldn't load</h3><p>Try again, or go back to Home.</p><a class="btn btn-primary" href="#/">Go home</a></div></div>`;
  }
  view.focus({ preventScroll: true });
}

// ── Status indicators ─────────────────────────────────────────────────
function paintStatus() {
  const q = state.queue;
  const syncChip = $('#sync-chip');
  const netChip = $('#net-chip');
  netChip.hidden = state.online;
  if (q.count > 0 || state.syncing) {
    syncChip.hidden = false;
    syncChip.classList.toggle('is-error', q.errors > 0);
    syncChip.classList.toggle('is-syncing', state.syncing);
    syncChip.querySelector('span').textContent = state.syncing && q.count ? `Syncing ${q.count}` : q.errors ? `${q.errors} need attention` : `${q.count} unsynced`;
  } else {
    syncChip.hidden = true;
  }
  const pending = state.boot?.pendingCount || 0;
  $$('.nav-badge').forEach((b) => {
    b.textContent = pending > 99 ? '99+' : String(pending);
    b.hidden = !pending;
  });
  const u = state.user;
  $$('.side-user').forEach((el) => {
    el.innerHTML = u
      ? `${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar-fallback">${esc((u.name || u.email || '?')[0].toUpperCase())}</span>`}<span><b>${esc(u.fullName || u.name || '')}</b><small>${esc(u.email)}</small></span>`
      : '';
  });
}

async function openQueueSheet() {
  const items = await queueItems();
  const rows = items.length
    ? items.map((it) => `
        <li class="queue-item ${it.error ? 'has-error' : ''}">
          <div>
            <b>${esc(it.op === 'delete' ? 'Delete' : it.op === 'update' ? 'Edit' : 'New')} · ${esc(it.txn?.note || it.txn?.category || it.txn?.type || 'entry')}</b>
            <small>${it.txn?.amount ? esc(money(it.txn.amount)) + ' · ' : ''}${esc(it.txn?.date || '')}${it.error ? ` · <span class="text-danger">${esc(it.error)}</span>` : ''}</small>
          </div>
          ${it.error ? `<button type="button" class="btn btn-ghost btn-sm" data-discard="${esc(it.id)}">Discard</button>` : ''}
        </li>`).join('')
    : '<li class="muted">Everything is synced.</li>';
  const s = sheet({
    title: 'Unsynced changes',
    body: `<p class="muted small">Changes are saved on this device and sent to your Sheet automatically when you're online.</p>
      <ul class="queue-list">${rows}</ul>
      <div class="sheet-actions">
        <button type="button" class="btn btn-primary" id="q-sync" ${state.online ? '' : 'disabled'}>${icon('refresh')} Sync now</button>
      </div>`,
    onOpen(el, api) {
      el.querySelector('#q-sync').addEventListener('click', async () => {
        api.close();
        const r = await retryQueued();
        if (r?.error) handleError(r.error);
        else if (r?.synced) toast(`Synced ${r.synced} change${r.synced > 1 ? 's' : ''}`, { type: 'ok' });
      });
      el.querySelectorAll('[data-discard]').forEach((b) =>
        b.addEventListener('click', async () => {
          api.close();
          if (await confirmDialog({ title: 'Discard this change?', message: "It hasn't reached your Sheet and will be lost.", confirmText: 'Discard', danger: true })) {
            await discardQueued(b.dataset.discard);
          }
        }),
      );
    },
  });
  return s.done;
}

function openMoreSheet() {
  const mode = themeMode();
  sheet({
    title: 'More',
    className: 'sheet-more',
    body: `
      <nav class="more-grid">
        <a href="#/reports" class="more-item">${icon('chart')}<span>Reports</span></a>
        <a href="#/settings" class="more-item">${icon('settings')}<span>Settings</span></a>
        <button type="button" class="more-item" id="more-sync">${icon('refresh')}<span>Sync now</span></button>
        <button type="button" class="more-item" id="more-theme">${icon(isDark() ? 'sun' : 'moon')}<span>${isDark() ? 'Light' : 'Dark'} mode</span></button>
      </nav>
      <p class="muted small center">Theme: ${esc(mode)} · change it in Settings</p>`,
    onOpen(el, api) {
      el.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => api.close()));
      el.querySelector('#more-theme').addEventListener('click', () => {
        setThemeMode(isDark() ? 'light' : 'dark');
        api.close();
      });
      el.querySelector('#more-sync').addEventListener('click', async () => {
        api.close();
        await syncEverything(true);
      });
    },
  });
}

async function syncEverything(verbose = false) {
  if (!navigator.onLine) {
    if (verbose) toast("You're offline. Changes will sync when you're back.", { type: 'offline' });
    return;
  }
  const r = await flushQueue();
  if (r?.error) handleError(r.error, { silent: !verbose });
  await loadBootstrap({ silent: !verbose });
  bus.emit('refresh');
  if (verbose && !r?.error) toast('Up to date', { type: 'ok' });
}

// ── Re-auth banner ────────────────────────────────────────────────────
let reauthShown = false;
async function showReauth() {
  if (reauthShown || !state.user) return;
  reauthShown = true;
  // First try silently (unless that just failed); only show the banner if Google needs a click.
  if (!auth.recentlyFailed()) {
    try {
      await auth.refresh();
      reauthShown = false;
      bus.emit('reauthed');
      return;
    } catch {
      /* needs interaction */
    }
  }
  const el = $('#reauth');
  el.hidden = false;
  try {
    await auth.renderButton(el.querySelector('.reauth-btn'), { dark: isDark() });
  } catch {
    el.querySelector('.reauth-btn').innerHTML = '<button type="button" class="btn btn-primary btn-sm" onclick="location.reload()">Reload</button>';
  }
}
function hideReauth() {
  reauthShown = false;
  $('#reauth').hidden = true;
}

// ── Setup-needed screen ───────────────────────────────────────────────
function renderNotConfigured() {
  document.body.classList.add('is-bare');
  $('#view').innerHTML = `
    <div class="page signin-page">
      <div class="signin-card">
        <div class="brand-mark big" aria-hidden="true">₱</div>
        <h1 class="display">Almost there</h1>
        <p class="muted">Open <code>js/config.js</code> and fill in <b>API_URL</b> and <b>GOOGLE_CLIENT_ID</b>. SETUP.md, steps 1–3, shows where to get them.</p>
      </div>
    </div>`;
}

// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  applyTheme();
  registerServiceWorker();

  if (!CONFIG.API_URL || !CONFIG.GOOGLE_CLIENT_ID) {
    renderNotConfigured();
    return;
  }

  state.user = auth.currentUser();
  auth.startAutoRefresh();
  await hydrate();

  bus.on('queue', (q) => {
    state.queue = q;
    paintStatus();
  });
  bus.on('syncing', (v) => {
    state.syncing = v;
    paintStatus();
  });
  bus.on('boot', paintStatus);
  bus.on('reauth-needed', showReauth);
  bus.on('auth-denied', async () => {
    auth.signOut();
    state.user = null;
    await kvClear();
    state.boot = null;
    state.dash = null;
    paintStatus();
    go('/signin?denied=1', { replace: true });
  });
  bus.on('reauthed', () => {
    hideReauth();
    syncEverything();
  });

  auth.onSignIn((user) => {
    const wasSignedIn = !!state.user;
    state.user = user;
    paintStatus();
    if (!$('#reauth').hidden) bus.emit('reauthed');
    if (!wasSignedIn) {
      loadBootstrap({ silent: false }).then(() => bus.emit('refresh'));
      scheduleFlush(500);
      go('/', { replace: true });
    }
  });

  window.addEventListener('online', () => {
    state.online = true;
    paintStatus();
    toast('Back online', { type: 'ok', duration: 1800 });
    syncEverything();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    paintStatus();
    toast("You're offline. You can still add entries.", { type: 'offline' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user && navigator.onLine) scheduleFlush(200);
  });
  setInterval(() => {
    if (state.user && navigator.onLine && state.queue.count) scheduleFlush();
  }, 60_000);

  $('#sync-chip').addEventListener('click', openQueueSheet);
  bus.on('open-queue', openQueueSheet);
  $$('[data-more]').forEach((b) => b.addEventListener('click', openMoreSheet));
  $$('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => setThemeMode(isDark() ? 'light' : 'dark')),
  );
  bus.on('theme', () => {
    $$('[data-theme-toggle]').forEach((b) => (b.innerHTML = `${icon(isDark() ? 'sun' : 'moon')}<span>${isDark() ? 'Light' : 'Dark'} mode</span>`));
  });
  bus.emit('theme', {});

  window.addEventListener('hashchange', render);
  await refreshQueueState();
  paintStatus();
  await render();

  if (state.user && navigator.onLine) {
    scheduleFlush(800);
    loadBootstrap();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    toast('A new version is ready', {
      action: 'Reload',
      onAction: () => {
        reloading = true;
        location.reload();
      },
      duration: 8000,
    });
  });
}

boot();
