import { CONFIG } from '../config.js';
import * as auth from '../auth.js';
import { api } from '../api.js';
import { kvClear, queueItems } from '../offline.js';
import { state, handleError, setBoot, loadBootstrap, wallets as walletList } from '../store.js';
import { esc, icon, money, monthKey, monthLabel, addMonths, toast, sheet, confirmDialog, timeAgo, copyText, onColor, bus } from '../ui.js';
import { themeMode, setThemeMode } from '../theme.js';

const SWATCHES = ['#0A6CFF', '#00A86B', '#9FE870', '#C9A227', '#E4572E', '#4F5BD5', '#17A398', '#B14AED', '#EF476F', '#FB8500', '#2A9D8F', '#14161A'];
const APP_VERSION = '2.0.0';

function needOnline() {
  if (navigator.onLine) return true;
  toast('This needs a connection.', { type: 'offline' });
  return false;
}

export default {
  async mount(el, ctx) {
    let catTab = 'Expense';
    let logFilter = 'Unparsed';
    let logData = null;
    let webhook = null;
    let tokenVisible = false;

    const s = () => state.boot?.settings || {};

    function render() {
      const u = state.user;
      const st = s();
      const allWallets = state.boot?.wallets || [];
      const cats = (state.boot?.categories || []).filter((c) => (catTab === 'Income' ? c.type !== 'Expense' : c.type !== 'Income'));
      const mode = themeMode();
      el.innerHTML = `
      <div class="page settings">
        <header class="page-head"><h1>Settings</h1></header>

        <section class="card set-section">
          <div class="account">
            ${u?.picture ? `<img class="avatar" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar avatar-fallback">${esc((u?.name || '?')[0])}</span>`}
            <div class="grow"><b>${esc(u?.fullName || u?.name || '')}</b><small class="muted">${esc(u?.email || '')}</small></div>
            <button type="button" class="btn btn-ghost btn-sm" id="signout">${icon('logout')} Sign out</button>
          </div>
        </section>

        <section class="card set-section">
          <h2>Appearance</h2>
          <div class="seg seg-sm" role="radiogroup" aria-label="Theme" id="theme">
            ${['auto', 'light', 'dark'].map((m) => `<button type="button" role="radio" data-m="${m}" class="${m === mode ? 'on' : ''}" aria-checked="${m === mode}">${icon(m === 'auto' ? 'contrast' : m === 'light' ? 'sun' : 'moon')} ${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
          </div>
        </section>

        <section class="card set-section" id="wallets">
          <div class="set-head"><h2>Wallets</h2><button type="button" class="btn btn-ghost btn-sm" data-wallet-new>${icon('plus')} Add</button></div>
          <ul class="set-list">
            ${allWallets.map((w) => `
              <li><button type="button" class="set-row ${w.archived ? 'is-archived' : ''}" data-wallet="${esc(w.name)}">
                <span class="wdot" style="background:${esc(w.color)};color:${onColor(w.color)}">${esc(w.name[0] || '?')}</span>
                <span class="grow"><b>${esc(w.name)}</b><small class="muted">${w.archived ? 'Archived · ' : ''}${w.unlisted ? 'Used in entries, not on the Wallets sheet · ' : ''}starts at ${esc(money(w.startingBalance || 0))}</small></span>
                <span class="set-val">${esc(money(w.balance || 0))}</span>${icon('chevron-right')}
              </button></li>`).join('') || '<li class="muted pad">No wallets yet.</li>'}
          </ul>
        </section>

        <section class="card set-section" id="categories">
          <div class="set-head"><h2>Categories</h2><button type="button" class="btn btn-ghost btn-sm" data-cat-new>${icon('plus')} Add</button></div>
          <div class="seg seg-sm" role="tablist" id="cat-tabs">
            ${['Expense', 'Income'].map((t) => `<button type="button" role="tab" data-t="${t}" class="${t === catTab ? 'on' : ''}" aria-selected="${t === catTab}">${t}</button>`).join('')}
          </div>
          <div class="chips chips-wrap cat-manage">
            ${cats.map((c) => `<button type="button" class="chip ${c.archived ? 'is-archived' : ''}" data-cat="${esc(c.name)}"><span class="emoji">${esc(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('') || '<p class="muted">No categories.</p>'}
          </div>
        </section>

        <section class="card set-section" id="wise">
          <div class="set-head"><h2>${icon('mail')} Wise email sync</h2></div>
          <label class="toggle-row">
            <span><b>Check Gmail every 15 minutes</b><small class="muted">Read-only. New Wise emails become Pending entries for review.</small></span>
            <span class="switch"><input type="checkbox" role="switch" id="wise-on" ${st.wiseSyncEnabled ? 'checked' : ''}><span></span></span>
          </label>
          ${st.wiseSyncEnabled && st.wiseTriggerActive === false ? `<div class="notice notice-danger">${icon('alert')}<span>The timer is missing. Turn sync off and on again to recreate it.</span></div>` : ''}
          <div class="field">
            <label class="field-label" for="wise-q">Gmail search</label>
            <div class="input-row">
              <input class="input mono" id="wise-q" value="${esc(st.wiseQuery || 'from:wise.com newer_than:30d')}" autocomplete="off" spellcheck="false">
              <button type="button" class="btn btn-ghost btn-sm" id="wise-q-save">Save</button>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="wise-w">Wallet for Wise entries</label>
            <select class="input" id="wise-w">${walletList().map((w) => `<option ${w.name === (st.wiseWallet || 'Wise') ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
          </div>
          <p class="muted small">Last check: ${esc(timeAgo(st.lastSync))}${st.lastSyncResult ? ` · ${esc(st.lastSyncResult)}` : ''}</p>
          <div class="btn-row">
            <button type="button" class="btn btn-primary btn-sm" id="wise-now">${icon('refresh')} Sync now</button>
            <button type="button" class="btn btn-ghost btn-sm" id="wise-retry">Retry unparsed</button>
          </div>
          <div class="log">
            <div class="set-head"><h3>Email log</h3>
              <div class="seg seg-xs" id="log-filter">${['Unparsed', 'Parsed', 'All'].map((f) => `<button type="button" data-f="${f}" class="${f === logFilter ? 'on' : ''}">${f}</button>`).join('')}</div>
            </div>
            <div id="log-list"><button type="button" class="btn btn-ghost btn-sm" id="log-load">Show log</button></div>
          </div>
        </section>

        <section class="card set-section" id="webhook">
          <div class="set-head"><h2>${icon('phone')} Phone notifications <span class="tag">MacroDroid</span></h2></div>
          <label class="toggle-row">
            <span><b>Accept notifications</b><small class="muted">GCash, Maya and Landbank alerts become Pending entries. Off by default.</small></span>
            <span class="switch"><input type="checkbox" role="switch" id="hook-on" ${st.webhookEnabled ? 'checked' : ''}><span></span></span>
          </label>
          <div id="hook-details">${st.webhookEnabled ? '<button type="button" class="btn btn-ghost btn-sm" id="hook-show">Show setup details</button>' : ''}</div>
        </section>

        <section class="card set-section">
          <h2>Data</h2>
          <div class="field">
            <label class="field-label" for="csv-m">Export CSV</label>
            <div class="input-row">
              <select class="input" id="csv-m"><option value="">All entries</option>${Array.from({ length: 12 }, (_, i) => addMonths(monthKey(), -i)).map((m) => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('')}</select>
              <button type="button" class="btn btn-primary btn-sm" id="csv">${icon('download')} Export</button>
            </div>
          </div>
          <ul class="set-list">
            <li><button type="button" class="set-row" id="unsynced">${icon('cloud-off')}<span class="grow"><b>Unsynced changes</b><small class="muted">Saved on this device, waiting to upload</small></span><span class="set-val">${state.queue.count}</span></button></li>
            ${state.boot?.sheetUrl ? `<li><a class="set-row" href="${esc(state.boot.sheetUrl)}" target="_blank" rel="noopener">${icon('table')}<span class="grow"><b>Open Google Sheet</b><small class="muted">Your data lives here</small></span>${icon('external')}</a></li>` : ''}
            <li><button type="button" class="set-row" id="clear-cache">${icon('trash')}<span class="grow"><b>Clear offline copy</b><small class="muted">Removes cached data from this device (unsynced changes are kept)</small></span></button></li>
          </ul>
        </section>

        <p class="muted small center about">Budget v${APP_VERSION}${state.boot?.apiVersion ? ` · API ${esc(state.boot.apiVersion)}` : ''} · ₱ PHP</p>
      </div>`;
      bind();
    }

    function bind() {
      el.querySelector('#signout').addEventListener('click', signOut);
      el.querySelectorAll('#theme [data-m]').forEach((b) =>
        b.addEventListener('click', () => {
          setThemeMode(b.dataset.m);
          render();
          if (navigator.onLine) api('saveSettings', { theme: b.dataset.m }).catch(() => {});
        }),
      );
      el.querySelector('[data-wallet-new]').addEventListener('click', () => walletSheet(null));
      el.querySelectorAll('[data-wallet]').forEach((b) =>
        b.addEventListener('click', () => walletSheet((state.boot?.wallets || []).find((w) => w.name === b.dataset.wallet))),
      );
      el.querySelectorAll('#cat-tabs [data-t]').forEach((b) =>
        b.addEventListener('click', () => {
          catTab = b.dataset.t;
          render();
        }),
      );
      el.querySelector('[data-cat-new]').addEventListener('click', () => categorySheet(null));
      el.querySelectorAll('[data-cat]').forEach((b) =>
        b.addEventListener('click', () => categorySheet((state.boot?.categories || []).find((c) => c.name === b.dataset.cat))),
      );

      el.querySelector('#wise-on').addEventListener('change', (e) => saveSetting({ wiseSyncEnabled: e.target.checked }, e.target.checked ? 'Wise sync is on' : 'Wise sync is off', e.target));
      el.querySelector('#wise-q-save').addEventListener('click', () => saveSetting({ wiseQuery: el.querySelector('#wise-q').value.trim() }, 'Search saved'));
      el.querySelector('#wise-w').addEventListener('change', (e) => saveSetting({ wiseWallet: e.target.value }, 'Saved'));
      el.querySelector('#wise-now').addEventListener('click', (e) => syncWise(e.currentTarget, false));
      el.querySelector('#wise-retry').addEventListener('click', (e) => syncWise(e.currentTarget, true));
      el.querySelector('#log-load').addEventListener('click', loadLog);
      el.querySelectorAll('#log-filter [data-f]').forEach((b) =>
        b.addEventListener('click', () => {
          logFilter = b.dataset.f;
          el.querySelectorAll('#log-filter [data-f]').forEach((x) => x.classList.toggle('on', x === b));
          loadLog();
        }),
      );

      el.querySelector('#hook-on').addEventListener('change', async (e) => {
        const on = e.target.checked;
        await saveSetting({ webhookEnabled: on }, on ? 'Phone notifications are on' : 'Phone notifications are off', e.target);
        if (on) showWebhook();
      });
      el.querySelector('#hook-show')?.addEventListener('click', showWebhook);

      el.querySelector('#csv').addEventListener('click', exportCsv);
      el.querySelector('#unsynced').addEventListener('click', () => bus.emit('open-queue'));
      el.querySelector('#clear-cache').addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Clear offline copy?', message: 'Cached dashboards and lists on this device are removed. Your Sheet is not touched, and unsynced changes are kept.', confirmText: 'Clear' });
        if (!ok) return;
        await kvClear();
        state.dash = null;
        toast('Offline copy cleared', { type: 'ok' });
        if (navigator.onLine) loadBootstrap();
      });
    }

    async function saveSetting(patch, okMsg, input) {
      if (!needOnline()) {
        if (input) input.checked = !input.checked;
        return;
      }
      try {
        const r = await api('saveSettings', patch);
        setBoot({ settings: r.settings });
        webhook = r.webhook;
        toast(okMsg, { type: 'ok' });
        render();
      } catch (err) {
        if (input) input.checked = !input.checked;
        handleError(err);
      }
    }

    async function syncWise(btn, retryUnparsed) {
      if (!needOnline()) return;
      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const r = await api('syncWiseNow', { retryUnparsed }, { timeout: 330000, retries: 0 });
        setBoot({ settings: r.settings, pendingCount: r.pendingCount });
        toast(`Wise: ${r.result.message}`, { type: 'ok', duration: 5000 });
        render();
        loadLog();
      } catch (err) {
        handleError(err);
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    async function loadLog() {
      const box = el.querySelector('#log-list');
      if (!box) return;
      if (!needOnline()) return;
      box.innerHTML = '<span class="skel skel-line w60"></span><span class="skel skel-line w40"></span>';
      try {
        logData = await api('getEmailLog', { status: logFilter === 'All' ? '' : logFilter, limit: 60 });
        if (!ctx.isCurrent()) return;
        const c = logData.counts || {};
        box.innerHTML = `
          <p class="muted small">${['Parsed', 'Unparsed', 'Skipped', 'Discarded'].map((k) => `${k} ${c[k] || 0}`).join(' · ')}</p>
          ${logData.items.length ? `<ul class="log-list">${logData.items.map((it) => `
            <li>
              <span class="status-pill st-${esc(it.status.toLowerCase())}">${esc(it.status)}</span>
              <div class="grow"><b>${esc(it.subject || '(no subject)')}</b>
              <small class="muted">${esc(it.source)} · ${esc(timeAgo(it.date))}${it.detail ? ` · ${esc(it.detail)}` : ''}</small></div>
            </li>`).join('')}</ul>` : `<p class="muted">${logFilter === 'Unparsed' ? 'No unparsed messages. 🎉' : 'Nothing logged yet.'}</p>`}`;
      } catch (err) {
        handleError(err);
        box.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" id="log-load2">Try again</button>';
        box.querySelector('#log-load2').addEventListener('click', loadLog);
      }
    }

    async function showWebhook() {
      if (!needOnline()) return;
      const box = el.querySelector('#hook-details');
      if (!webhook || !webhook.token) {
        try {
          webhook = await api('getWebhookInfo');
        } catch (err) {
          handleError(err);
          return;
        }
      }
      const token = webhook.token || '';
      const shown = tokenVisible ? token : `${'•'.repeat(12)}${token.slice(-4)}`;
      const body = JSON.stringify({ action: 'webhook', token: tokenVisible ? token : '<token>', app: '[not_app_name]', title: '[not_title]', text: '[notification]' }, null, 2);
      box.innerHTML = `
        <div class="field"><div class="field-label">URL (HTTP POST)</div>
          <div class="input-row"><code class="code-line">${esc(CONFIG.API_URL)}</code><button type="button" class="btn btn-ghost btn-sm" data-copy="url">${icon('copy')}</button></div></div>
        <div class="field"><div class="field-label">Token</div>
          <div class="input-row"><code class="code-line mono">${esc(shown)}</code>
            <button type="button" class="btn btn-ghost btn-sm" id="tok-eye" aria-label="${tokenVisible ? 'Hide' : 'Show'} token">${icon(tokenVisible ? 'eye-off' : 'eye')}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-copy="token">${icon('copy')}</button></div></div>
        <div class="field"><div class="field-label">Request body (Content type: text/plain or application/json)</div>
          <pre class="code-block">${esc(body)}</pre>
          <button type="button" class="btn btn-ghost btn-sm" data-copy="body">${icon('copy')} Copy body</button></div>
        <p class="muted small">See SETUP.md step 8 for the MacroDroid macro. Unmatched notifications show in the email log as “Unparsed”.</p>
        <button type="button" class="btn btn-danger-ghost btn-sm" id="tok-regen">${icon('refresh')} Regenerate token</button>`;
      const values = { url: CONFIG.API_URL, token, body: JSON.stringify({ action: 'webhook', token, app: '[not_app_name]', title: '[not_title]', text: '[notification]' }) };
      box.querySelectorAll('[data-copy]').forEach((b) =>
        b.addEventListener('click', async () => toast((await copyText(values[b.dataset.copy])) ? 'Copied' : "Couldn't copy", { type: 'ok', duration: 1500 })),
      );
      box.querySelector('#tok-eye').addEventListener('click', () => {
        tokenVisible = !tokenVisible;
        showWebhook();
      });
      box.querySelector('#tok-regen').addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Regenerate the token?', message: 'The old token stops working right away. Update it in MacroDroid afterwards.', confirmText: 'Regenerate', danger: true });
        if (!ok || !needOnline()) return;
        try {
          const r = await api('saveSettings', { regenerateWebhookToken: true });
          webhook = r.webhook;
          tokenVisible = true;
          toast('New token created', { type: 'ok' });
          showWebhook();
        } catch (err) {
          handleError(err);
        }
      });
    }

    async function exportCsv() {
      if (!needOnline()) return;
      const btn = el.querySelector('#csv');
      btn.disabled = true;
      try {
        const month = el.querySelector('#csv-m').value;
        const r = await api('exportCsv', month ? { month } : {}, { timeout: 60000 });
        const blob = new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' });
        const file = new File([blob], r.filename, { type: 'text/csv' });
        if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: r.filename });
            return;
          } catch (e) {
            if (e.name === 'AbortError') return;
          }
        }
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: r.filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast(`Exported ${r.rows} entr${r.rows === 1 ? 'y' : 'ies'}`, { type: 'ok' });
      } catch (err) {
        handleError(err);
      } finally {
        btn.disabled = false;
      }
    }

    async function signOut() {
      const n = (await queueItems()).length;
      const ok = await confirmDialog({
        title: 'Sign out?',
        message: n
          ? `${n} change${n > 1 ? 's have' : ' has'} not synced yet. They stay on this device and sync the next time you sign in.`
          : 'Cached data is removed from this device.',
        confirmText: 'Sign out',
        danger: !!n,
      });
      if (!ok) return;
      auth.signOut();
      if (!n) await kvClear();
      state.user = null;
      state.boot = null;
      state.dash = null;
      bus.emit('boot', null);
      ctx.go('/signin');
    }

    function walletSheet(w) {
      if (!needOnline()) return;
      const isNew = !w;
      let color = w?.color || SWATCHES[(state.boot?.wallets || []).length % SWATCHES.length];
      const sw = () => SWATCHES.concat(SWATCHES.includes(color) ? [] : [color])
        .map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
      sheet({
        title: isNew ? 'New wallet' : `Edit ${w.name}`,
        body: `
          <form class="stack" id="wf" novalidate>
            <div class="field"><label class="field-label" for="wn">Name</label><input class="input" id="wn" maxlength="40" value="${esc(w?.name || '')}" required autocomplete="off"></div>
            <div class="field"><label class="field-label" for="wb">Starting balance (₱)</label>
              <input class="input" id="wb" inputmode="decimal" value="${esc(w ? String(w.startingBalance || 0) : '0')}" autocomplete="off">
              <small class="muted">What was in this wallet before your first entry.</small></div>
            <div class="field"><div class="field-label">Color</div><div class="swatches" id="sw">${sw()}</div></div>
            ${isNew ? '' : `<label class="toggle-row"><span><b>Archived</b><small class="muted">Hidden from pickers; history is kept.</small></span><span class="switch"><input type="checkbox" role="switch" id="wa" ${w.archived ? 'checked' : ''}><span></span></span></label>
              <p class="muted small">Renaming updates all entries that use “${esc(w.name)}”.</p>`}
            <div class="form-error" id="we" hidden></div>
            <div class="sheet-actions"><button type="submit" class="btn btn-primary">${icon('check')} Save</button></div>
          </form>`,
        onOpen(dlg, sh) {
          const swBox = dlg.querySelector('#sw');
          const bindSw = () => swBox.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
            color = b.dataset.c;
            swBox.innerHTML = sw();
            bindSw();
          }));
          bindSw();
          dlg.querySelector('#wf').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = dlg.querySelector('#we');
            const name = dlg.querySelector('#wn').value.trim();
            const sb = Number(dlg.querySelector('#wb').value.replace(/[₱,\s]/g, ''));
            if (!name) return Object.assign(err, { hidden: false, textContent: 'Give the wallet a name.' });
            if (!Number.isFinite(sb)) return Object.assign(err, { hidden: false, textContent: 'Starting balance must be a number.' });
            const btn = dlg.querySelector('[type="submit"]');
            btn.disabled = true;
            try {
              const r = await api('saveWallet', { id: w?.id || '', originalName: w?.name || '', name, color, startingBalance: sb, archived: dlg.querySelector('#wa')?.checked || false });
              setBoot({ wallets: r.wallets, totalBalance: r.totalBalance });
              state.dash = null;
              sh.close();
              toast('Wallet saved', { type: 'ok' });
              render();
            } catch (ex) {
              btn.disabled = false;
              if (ex.code === 'VALIDATION' || ex.code === 'CONFLICT') Object.assign(err, { hidden: false, textContent: ex.message });
              else handleError(ex);
            }
          });
          if (isNew) dlg.querySelector('#wn').focus();
        },
      });
    }

    function categorySheet(c) {
      if (!needOnline()) return;
      const isNew = !c;
      let type = c?.type || catTab;
      sheet({
        title: isNew ? 'New category' : `Edit ${c.name}`,
        body: `
          <form class="stack" id="cf" novalidate>
            <div class="field-row">
              <div class="field"><label class="field-label" for="ci">Icon</label><input class="input emoji-input" id="ci" maxlength="8" value="${esc(c?.icon || '🏷️')}" autocomplete="off"></div>
              <div class="field grow"><label class="field-label" for="cn">Name</label><input class="input" id="cn" maxlength="40" value="${esc(c?.name || '')}" autocomplete="off"></div>
            </div>
            <div class="field"><div class="field-label">Used for</div>
              <div class="seg seg-sm" id="ct">${['Expense', 'Income', 'Both'].map((t) => `<button type="button" data-t="${t}" class="${t === type ? 'on' : ''}">${t}</button>`).join('')}</div></div>
            ${isNew ? '' : `<label class="toggle-row"><span><b>Archived</b><small class="muted">Hidden from pickers; history is kept.</small></span><span class="switch"><input type="checkbox" role="switch" id="ca" ${c.archived ? 'checked' : ''}><span></span></span></label>
              <p class="muted small">Renaming updates all entries in “${esc(c.name)}”.</p>`}
            <div class="form-error" id="ce" hidden></div>
            <div class="sheet-actions"><button type="submit" class="btn btn-primary">${icon('check')} Save</button></div>
          </form>`,
        onOpen(dlg, sh) {
          dlg.querySelectorAll('#ct [data-t]').forEach((b) => b.addEventListener('click', () => {
            type = b.dataset.t;
            dlg.querySelectorAll('#ct [data-t]').forEach((x) => x.classList.toggle('on', x === b));
          }));
          dlg.querySelector('#cf').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = dlg.querySelector('#ce');
            const name = dlg.querySelector('#cn').value.trim();
            if (!name) return Object.assign(err, { hidden: false, textContent: 'Give the category a name.' });
            const btn = dlg.querySelector('[type="submit"]');
            btn.disabled = true;
            try {
              const r = await api('saveCategory', { id: c?.id || '', originalName: c?.name || '', name, icon: dlg.querySelector('#ci').value.trim(), type, archived: dlg.querySelector('#ca')?.checked || false });
              setBoot({ categories: r.categories });
              sh.close();
              toast('Category saved', { type: 'ok' });
              render();
            } catch (ex) {
              btn.disabled = false;
              if (ex.code === 'VALIDATION' || ex.code === 'CONFLICT') Object.assign(err, { hidden: false, textContent: ex.message });
              else handleError(ex);
            }
          });
          if (isNew) dlg.querySelector('#cn').focus();
        },
      });
    }

    render();
    ctx.on('boot', render);
    ctx.on('queue', () => {
      const v = el.querySelector('#unsynced .set-val');
      if (v) v.textContent = state.queue.count;
    });
    if (navigator.onLine) loadBootstrap();
  },
};
