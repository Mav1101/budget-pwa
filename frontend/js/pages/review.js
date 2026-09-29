import { api } from '../api.js';
import { kvGet, kvSet } from '../offline.js';
import { state, handleError, remember, wallets, categories, setPendingCount, setHandoff, categoryMap } from '../store.js';
import { esc, icon, money, dayLabel, emptyState, skeletonRows, toast, confirmDialog, timeAgo } from '../ui.js';

export default {
  async mount(el, ctx) {
    let items = [];
    let offline = false;
    const edits = new Map(); // id → { category?, toWallet?, type? }
    let busy = false;

    el.innerHTML = `
      <div class="page review">
        <header class="page-head">
          <h1>Review</h1>
          <button type="button" class="btn btn-ghost btn-sm" id="sync">${icon('refresh')} Check Wise</button>
        </header>
        <p class="muted small" id="last-sync"></p>
        <div id="bar"></div>
        <div id="list" class="review-list">${skeletonRows(3)}</div>
      </div>`;
    const list = el.querySelector('#list');
    const bar = el.querySelector('#bar');

    const current = (t) => ({ ...t, ...(edits.get(t.id) || {}) });
    const needsDest = (t) => t.type === 'Transfer' && !t.toWallet;

    function paint() {
      const s = state.boot?.settings;
      el.querySelector('#last-sync').textContent = s?.lastSync ? `Wise checked ${timeAgo(s.lastSync)}${s.lastSyncResult ? ` · ${s.lastSyncResult}` : ''}` : '';
      if (!items.length) {
        bar.innerHTML = '';
        list.innerHTML = emptyState({
          title: offline ? "You're offline" : 'All caught up',
          text: offline ? 'Pending entries load when you are online.' : 'New entries from Wise emails and phone notifications appear here for approval.',
          iconName: offline ? 'cloud-off' : 'check',
        });
        return;
      }
      const cats = categoryMap();
      const walletOpts = (sel, exclude) =>
        `<option value="">Choose…</option>` +
        wallets({ includeArchived: false })
          .filter((w) => w.name !== exclude)
          .map((w) => `<option ${w.name === sel ? 'selected' : ''}>${esc(w.name)}</option>`)
          .join('');
      const catOpts = (type, sel) => {
        const list = categories(type);
        const extra = sel && !list.some((c) => c.name === sel) ? `<option selected>${esc(sel)}</option>` : '';
        return extra + list.map((c) => `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
      };

      bar.innerHTML = `
        <div class="review-bar">
          <span><b>${items.length}</b> pending</span>
          <button type="button" class="btn btn-primary btn-sm" id="approve-all" ${offline ? 'disabled' : ''}>${icon('check-all')} Approve all</button>
        </div>`;
      list.innerHTML = items
        .map((raw) => {
          const t = current(raw);
          const cls = t.type === 'Income' ? 'amt-in' : t.type === 'Expense' ? 'amt-out' : 'amt-trf';
          const amt = t.type === 'Income' ? money(t.amount, { sign: true }) : t.type === 'Expense' ? money(-t.amount) : money(t.amount);
          return `
          <article class="rcard" data-id="${esc(t.id)}">
            <header class="rcard-head">
              <span class="src-badge src-${t.source === 'Webhook' ? 'hook' : 'wise'}">${icon(t.source === 'Webhook' ? 'phone' : 'mail')}${esc(t.source)}</span>
              <span class="muted small">${esc(dayLabel(t.date))}</span>
            </header>
            <div class="rcard-amt ${cls}">${esc(amt)}${t.originalCurrency && t.originalCurrency !== 'PHP' ? `<small>${esc(t.originalAmount)} ${esc(t.originalCurrency)}</small>` : ''}</div>
            <p class="rcard-note">${esc(t.note || '—')}</p>
            <div class="rcard-fields">
              <label><span>Type</span>
                <select data-f="type">${['Expense', 'Income', 'Transfer'].map((x) => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select>
              </label>
              <label><span>${t.type === 'Transfer' ? 'From' : 'Wallet'}</span>
                <select data-f="wallet">${walletOpts(t.wallet)}${wallets().some((w) => w.name === t.wallet) ? '' : `<option selected>${esc(t.wallet)}</option>`}</select>
              </label>
              ${t.type === 'Transfer'
                ? `<label class="${needsDest(t) ? 'needs' : ''}"><span>To wallet</span><select data-f="toWallet">${walletOpts(t.toWallet, t.wallet)}</select></label>`
                : `<label><span>Category</span><select data-f="category">${catOpts(t.type, t.category)}</select></label>`}
            </div>
            <footer class="rcard-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-act="discard">${icon('x')} Discard</button>
              <button type="button" class="btn btn-ghost btn-sm" data-act="edit">${icon('edit')} Edit</button>
              <button type="button" class="btn btn-primary btn-sm" data-act="approve" ${offline ? 'disabled' : ''}>${icon('check')} Approve</button>
            </footer>
          </article>`;
        })
        .join('');

      list.querySelectorAll('.rcard').forEach((card) => {
        const id = card.dataset.id;
        card.querySelectorAll('select[data-f]').forEach((s) =>
          s.addEventListener('change', () => {
            const e = { ...(edits.get(id) || {}), [s.dataset.f]: s.value };
            if (s.dataset.f === 'type') {
              const cat = cats.get(current(items.find((x) => x.id === id)).category);
              if (s.value !== 'Transfer' && cat && cat.type !== s.value && cat.type !== 'Both') e.category = categories(s.value)[0]?.name || '';
              if (s.value !== 'Transfer') e.toWallet = '';
            }
            edits.set(id, e);
            paint();
          }),
        );
        card.querySelector('[data-act="approve"]').addEventListener('click', () => approve([id]));
        card.querySelector('[data-act="discard"]').addEventListener('click', () => discard(id));
        card.querySelector('[data-act="edit"]').addEventListener('click', () => {
          setHandoff({ txn: current(items.find((x) => x.id === id)) });
          ctx.go(`/edit/${encodeURIComponent(id)}?pending=1`);
        });
      });
      bar.querySelector('#approve-all')?.addEventListener('click', approveAll);
    }

    async function load() {
      try {
        const r = await api('listPending');
        if (!ctx.isCurrent()) return;
        offline = false;
        items = r.items;
        remember(items);
        kvSet('pending', items);
        setPendingCount(r.total);
      } catch (err) {
        if (!ctx.isCurrent()) return;
        const cached = await kvGet('pending');
        items = cached || [];
        offline = true;
        handleError(err, { silent: err.code === 'OFFLINE' });
      }
      paint();
    }

    function removeCards(ids) {
      const set = new Set(ids);
      items = items.filter((t) => !set.has(t.id));
      ids.forEach((id) => edits.delete(id));
      kvSet('pending', items);
    }

    async function approve(ids) {
      if (busy) return;
      const payload = ids.map((id) => ({ id, txn: edits.get(id) || {} }));
      const missing = ids.map((id) => current(items.find((x) => x.id === id))).filter(needsDest);
      if (missing.length && ids.length === 1) {
        toast('Choose the wallet the money went to first.', { type: 'error' });
        list.querySelector(`[data-id="${CSS.escape(ids[0])}"] select[data-f="toWallet"]`)?.focus();
        return;
      }
      busy = true;
      const cards = ids.map((id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
      cards.forEach((c) => c.classList.add('is-busy'));
      try {
        const r = await api('approvePending', { items: payload });
        removeCards(r.approvedIds || []);
        setPendingCount(r.pendingCount);
        if (r.approved) toast(`Approved ${r.approved} entr${r.approved === 1 ? 'y' : 'ies'}`, { type: 'ok' });
        if (r.failed?.length) toast(`${r.failed.length} need attention: ${r.failed[0].message}`, { type: 'error' });
        state.dash = null;
      } catch (err) {
        handleError(err);
      } finally {
        busy = false;
        paint();
      }
    }

    async function approveAll() {
      const ready = items.map(current).filter((t) => !needsDest(t));
      const skipped = items.length - ready.length;
      const ok = await confirmDialog({
        title: `Approve ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'}?`,
        message: skipped ? `${skipped} transfer${skipped === 1 ? '' : 's'} without a destination wallet will stay here.` : 'They will count toward your balances.',
        confirmText: 'Approve',
      });
      if (ok && ready.length) approve(ready.map((t) => t.id));
    }

    async function discard(id) {
      const t = items.find((x) => x.id === id);
      const ok = await confirmDialog({
        title: 'Discard this entry?',
        message: `${money(t.amount)} · ${t.note || t.type}. The email stays in Gmail and won't be imported again.`,
        confirmText: 'Discard',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await api('discardPending', { ids: [id] });
        removeCards([id]);
        setPendingCount(r.pendingCount);
        toast('Discarded', { type: 'ok' });
      } catch (err) {
        handleError(err);
      }
      paint();
    }

    el.querySelector('#sync').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!navigator.onLine) {
        toast("You're offline.", { type: 'offline' });
        return;
      }
      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const r = await api('syncWiseNow', {}, { timeout: 330000, retries: 0 });
        if (state.boot) state.boot.settings = r.settings;
        toast(`Wise: ${r.result.message}`, { type: 'ok', duration: 4500 });
        await load();
      } catch (err) {
        handleError(err);
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    });

    ctx.on('reauthed', load);
    ctx.on('refresh', load);
    ctx.on('boot', () => {
      if (!items.length) paint();
    });
    await load();
  },
};
