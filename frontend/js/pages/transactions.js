import { api } from '../api.js';
import { kvGet, kvSet, overlay } from '../offline.js';
import { state, handleError, remember, wallets, categories, categoryMap, walletMap } from '../store.js';
import { esc, icon, money, dayLabel, monthLabel, monthKey, addMonths, txnRow, emptyState, skeletonRows, debounce, signedAmount } from '../ui.js';
import { openTxnDetail } from '../detail.js';

const PAGE = 40;
const FILTER_KEYS = ['q', 'wallet', 'type', 'category', 'month'];

export default {
  async mount(el, ctx) {
    const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, ctx.query[k] || '']));
    let items = [];
    let offset = 0;
    let total = 0;
    let totals = null;
    let done = false;
    let loading = false;
    let seq = 0;
    let fromCache = false;

    const months = Array.from({ length: 24 }, (_, i) => addMonths(monthKey(), -i));
    const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;

    el.innerHTML = `
      <div class="page txns">
        <header class="page-head"><h1>Transactions</h1><a href="#/add" class="btn btn-primary btn-sm hide-mobile">${icon('plus')} Add</a></header>
        <div class="search">
          ${icon('search')}
          <input type="search" id="q" placeholder="Search notes, categories, amounts" value="${esc(filters.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search">
        </div>
        <div class="filters" role="group" aria-label="Filters">
          <label class="select-pill"><span class="sr-only">Month</span>
            <select id="f-month">${opt('', 'All months', filters.month)}${months.map((m) => opt(m, monthLabel(m), filters.month)).join('')}</select>
          </label>
          <label class="select-pill"><span class="sr-only">Wallet</span>
            <select id="f-wallet">${opt('', 'All wallets', filters.wallet)}${wallets({ includeArchived: true }).map((w) => opt(w.name, w.name, filters.wallet)).join('')}</select>
          </label>
          <label class="select-pill"><span class="sr-only">Type</span>
            <select id="f-type">${opt('', 'All types', filters.type)}${['Expense', 'Income', 'Transfer'].map((t) => opt(t, t, filters.type)).join('')}</select>
          </label>
          <label class="select-pill"><span class="sr-only">Category</span>
            <select id="f-category">${opt('', 'All categories', filters.category)}${categories().map((c) => opt(c.name, `${c.icon} ${c.name}`, filters.category)).join('')}</select>
          </label>
          <button type="button" class="chip chip-sm" id="clear" hidden>${icon('x')} Clear</button>
        </div>
        <div class="list-summary" id="summary" aria-live="polite"></div>
        <div class="txn-groups" id="list">${skeletonRows(8)}</div>
        <div class="sentinel" id="sentinel"></div>
      </div>`;

    const list = el.querySelector('#list');
    const summary = el.querySelector('#summary');
    const clearBtn = el.querySelector('#clear');

    const hasFilters = () => FILTER_KEYS.some((k) => filters[k]);
    const isDefault = () => !hasFilters();

    function localFilter(t) {
      if (filters.month && t.date.slice(0, 7) !== filters.month) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.wallet && t.wallet !== filters.wallet && t.toWallet !== filters.wallet) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (filters.q) {
        const hay = `${t.note} ${t.category} ${t.wallet} ${t.toWallet} ${Number(t.amount).toFixed(2)}`.toLowerCase();
        if (!hay.includes(filters.q.toLowerCase())) return false;
      }
      return t.status !== 'Pending';
    }

    function paint() {
      clearBtn.hidden = !hasFilters();
      const cats = categoryMap();
      const wmap = walletMap();
      const shown = overlay(items, state.queue.items || [], { includeAdds: true, filter: localFilter })
        .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.date < b.date ? 1 : -1));

      if (!shown.length && !loading) {
        list.innerHTML = emptyState(
          hasFilters()
            ? { title: 'No matches', text: 'Try a different search or clear the filters.', iconName: 'search', action: '<button type="button" class="btn btn-ghost" data-clear>Clear filters</button>' }
            : fromCache
              ? { title: "You're offline", text: 'Nothing cached yet. Connect to load your entries.', iconName: 'cloud-off' }
              : { title: 'No entries yet', text: 'Your transactions will show up here.', iconName: 'list', action: '<a class="btn btn-primary" href="#/add">Add entry</a>' },
        );
        list.querySelector('[data-clear]')?.addEventListener('click', clearAll);
        summary.textContent = '';
        return;
      }

      const groups = new Map();
      for (const t of shown) {
        if (!groups.has(t.date)) groups.set(t.date, []);
        groups.get(t.date).push(t);
      }
      list.innerHTML =
        [...groups.entries()]
          .map(([date, rows]) => {
            const net = rows.reduce((s, t) => s + signedAmount(t), 0);
            return `<section class="day">
              <h3 class="day-head"><span>${esc(dayLabel(date))}</span><span class="${net > 0 ? 'amt-in' : net < 0 ? 'amt-out' : 'muted'}">${net ? esc(money(net, { sign: true })) : ''}</span></h3>
              <div class="txn-list">${rows.map((t) => txnRow(t, { cats, wallets: wmap })).join('')}</div>
            </section>`;
          })
          .join('') + (loading ? skeletonRows(3) : !done ? '' : `<p class="list-end">${fromCache ? 'Showing saved copy · offline' : `${total} entr${total === 1 ? 'y' : 'ies'}`}</p>`);

      list.querySelectorAll('.txn').forEach((b) =>
        b.addEventListener('click', () => {
          const t = shown.find((x) => x.id === b.dataset.id);
          if (t) openTxnDetail(t, { go: ctx.go, onDeleted: paint });
        }),
      );

      if (totals && (hasFilters() || fromCache === false)) {
        summary.innerHTML = `<span>${total} result${total === 1 ? '' : 's'}</span>
          <span class="amt-in">${esc(money(totals.income, { sign: true }))}</span>
          <span class="amt-out">${esc(money(-totals.expense))}</span>`;
      } else summary.textContent = '';
    }

    async function load(reset) {
      if (loading && !reset) return;
      const my = ++seq;
      if (reset) {
        items = [];
        offset = 0;
        done = false;
        totals = null;
        list.innerHTML = skeletonRows(8);
      }
      loading = true;
      try {
        const r = await api('listTransactions', { ...filters, offset, limit: PAGE });
        if (my !== seq || !ctx.isCurrent()) return;
        fromCache = false;
        items = reset ? r.items : items.concat(r.items);
        remember(r.items);
        offset = r.nextOffset ?? offset + r.items.length;
        done = r.nextOffset == null;
        total = r.total;
        totals = r.totals;
        if (reset && isDefault()) kvSet('txns:recent', { items: r.items, total: r.total, totals: r.totals });
      } catch (err) {
        if (my !== seq || !ctx.isCurrent()) return;
        if (reset) {
          const cached = await kvGet('txns:recent');
          fromCache = true;
          items = cached?.items || [];
          remember(items);
          total = cached?.total || items.length;
          totals = null;
          done = true;
        }
        handleError(err, { silent: err.code === 'OFFLINE' || !reset });
      } finally {
        if (my === seq) loading = false;
      }
      if (ctx.isCurrent()) paint();
    }

    function applyFilters() {
      ctx.setQuery(filters);
      load(true);
    }
    function clearAll() {
      FILTER_KEYS.forEach((k) => (filters[k] = ''));
      el.querySelector('#q').value = '';
      ['month', 'wallet', 'type', 'category'].forEach((k) => (el.querySelector(`#f-${k}`).value = ''));
      applyFilters();
    }

    el.querySelector('#q').addEventListener(
      'input',
      debounce((e) => {
        filters.q = e.target.value.trim();
        applyFilters();
      }, 350),
    );
    ['month', 'wallet', 'type', 'category'].forEach((k) =>
      el.querySelector(`#f-${k}`).addEventListener('change', (e) => {
        filters[k] = e.target.value;
        applyFilters();
      }),
    );
    clearBtn.addEventListener('click', clearAll);

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !done && !loading && !fromCache && items.length) load(false);
      },
      { rootMargin: '400px' },
    );
    io.observe(el.querySelector('#sentinel'));

    ctx.on('queue', paint);
    ctx.on('synced', () => load(true));
    ctx.on('refresh', () => load(true));
    ctx.on('reauthed', () => load(true));
    await load(true);
    return () => io.disconnect();
  },
};
