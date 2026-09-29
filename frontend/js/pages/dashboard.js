import { api } from '../api.js';
import { kvSet } from '../offline.js';
import { state, handleError, remember, categoryMap, walletMap } from '../store.js';
import { esc, icon, money, moneyParts, monthKey, monthLabel, txnRow, emptyState, skeletonRows, onColor, hashColor, round2 } from '../ui.js';
import { openTxnDetail } from '../detail.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Magandang umaga';
  if (h < 18) return 'Magandang hapon';
  return 'Magandang gabi';
}

/** Applies queued (unsynced) adds/edits/deletes to the server snapshot so the UI is instant. */
function withLocal(d, queue) {
  const out = structuredClone(d);
  const bal = new Map(out.wallets.map((w) => [w.name, w]));
  const month = out.month;
  const addTo = (name, delta) => {
    if (!name) return;
    if (!bal.has(name)) {
      const w = { name, color: '#7A7366', balance: 0, archived: false, unlisted: true };
      bal.set(name, w);
      out.wallets.push(w);
    }
    bal.get(name).balance = round2(bal.get(name).balance + delta);
  };
  const deleted = new Set();
  const edited = new Map();
  for (const q of queue) {
    if (q.op === 'delete') deleted.add(q.id);
    else if (q.op === 'update') edited.set(q.id, q.txn);
    else if (q.op === 'add' && q.txn.status !== 'Pending') {
      const t = q.txn;
      if (t.type === 'Income') addTo(t.wallet, t.amount);
      else if (t.type === 'Expense') addTo(t.wallet, -t.amount);
      else {
        addTo(t.wallet, -t.amount);
        addTo(t.toWallet, t.amount);
      }
      if (t.date.slice(0, 7) === month) {
        if (t.type === 'Income') {
          out.income = round2(out.income + t.amount);
          out.incomeTotals[t.category] = round2((out.incomeTotals[t.category] || 0) + t.amount);
        } else if (t.type === 'Expense') {
          out.expense = round2(out.expense + t.amount);
          out.categoryTotals[t.category] = round2((out.categoryTotals[t.category] || 0) + t.amount);
          const day = Number(t.date.slice(8, 10));
          if (out.daily[day - 1] != null) out.daily[day - 1] = round2(out.daily[day - 1] + t.amount);
        }
      }
    }
  }
  const adds = queue.filter((q) => q.op === 'add' && q.txn.status !== 'Pending').map((q) => ({ ...q.txn, _unsynced: true }));
  const recent = out.recent
    .filter((t) => !deleted.has(t.id))
    .map((t) => (edited.has(t.id) ? { ...edited.get(t.id), _unsynced: true } : t))
    .filter((t) => !adds.some((a) => a.id === t.id));
  out.recent = [...adds, ...recent]
    .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.date < b.date ? 1 : -1))
    .slice(0, 8);
  out.totalBalance = round2(out.wallets.reduce((s, w) => s + (w.balance || 0), 0));
  return out;
}

function sparkline(daily, month) {
  const max = Math.max(...daily, 1);
  const today = monthKey() === month ? new Date().getDate() : 0;
  const w = 100 / daily.length;
  const bars = daily
    .map((v, i) => {
      const h = v > 0 ? Math.max(4, (v / max) * 100) : 2;
      const cls = i + 1 === today ? 'is-today' : i + 1 > today && today ? 'is-future' : '';
      return `<rect class="${cls}" x="${(i * w + w * 0.18).toFixed(2)}" y="${(100 - h).toFixed(2)}" width="${(w * 0.64).toFixed(2)}" height="${h.toFixed(2)}" rx="1"><title>${i + 1}: ${money(v)}</title></rect>`;
    })
    .join('');
  return `<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily spending this month">${bars}</svg>`;
}

function pctChange(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

function view(d) {
  const user = state.user;
  const cats = categoryMap();
  const wmap = walletMap();
  const p = moneyParts(d.totalBalance);
  const pending = d.pendingCount ?? state.boot?.pendingCount ?? 0;
  const active = d.wallets.filter((w) => !w.archived || w.balance);
  const net = round2(d.income - d.expense);
  const [y, m] = d.month.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const daysLeft = monthKey() === d.month ? daysIn - new Date().getDate() : 0;
  const flowMax = Math.max(d.income, d.expense, 1);
  const spendDelta = pctChange(d.expense, d.prevExpense);

  const top = Object.entries(d.categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topMax = top[0]?.[1] || 1;

  return `
  <div class="page dash">
    <section class="hero">
      <p class="eyebrow">${esc(greeting())}${user?.name ? `, ${esc(user.name)}` : ''}</p>
      <div class="hero-label">Total balance</div>
      <div class="hero-amount" aria-label="${esc(money(d.totalBalance))}">
        <span class="cur">${p.sign}₱</span><span class="whole">${p.whole}</span><span class="cents">.${p.cents}</span>
      </div>
      <div class="hero-meta">
        <span class="chip-stat">${icon('arrow-down')}${esc(money(d.income, { compact: true }))} in</span>
        <span class="chip-stat">${icon('arrow-up')}${esc(money(d.expense, { compact: true }))} out</span>
        <span class="muted">${esc(monthLabel(d.month))}</span>
      </div>
    </section>

    ${pending ? `
    <a class="pending-banner" href="#/review">
      <span class="pb-ic">${icon('inbox')}</span>
      <span><b>${pending} to review</b><small>From Wise emails and phone notifications</small></span>
      ${icon('chevron-right')}
    </a>` : ''}

    <section class="section">
      <div class="section-head"><h2>Wallets</h2><a href="#/settings" class="link">Manage</a></div>
      <div class="wallet-strip" role="list">
        ${active.map((w) => {
          const share = d.totalBalance > 0 && w.balance > 0 ? Math.round((w.balance / d.totalBalance) * 100) : 0;
          return `
          <a role="listitem" class="wcard" href="#/transactions?wallet=${encodeURIComponent(w.name)}" style="--wc:${esc(w.color)};--on:${onColor(w.color)}">
            <span class="wcard-top"><span class="wcard-name">${esc(w.name)}</span><span class="wcard-chip" aria-hidden="true"></span></span>
            <span class="wcard-bal">${esc(money(w.balance))}</span>
            <span class="wcard-foot">${w.archived ? 'Archived' : share ? `${share}% of total` : '&nbsp;'}</span>
          </a>`;
        }).join('')}
        <a role="listitem" class="wcard wcard-add" href="#/settings">${icon('plus')}<span>Add wallet</span></a>
      </div>
    </section>

    <div class="dash-grid">
      <section class="card month-card">
        <div class="card-head"><h2>${esc(monthLabel(d.month, 'short'))} so far</h2>${daysLeft ? `<span class="muted small">${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span>` : ''}</div>
        <div class="flow">
          <div><small>Income</small><b class="amt-in">${esc(money(d.income))}</b></div>
          <div><small>Spent</small><b class="amt-out">${esc(money(d.expense))}</b></div>
          <div><small>Net</small><b class="${net >= 0 ? 'amt-in' : 'amt-out'}">${esc(money(net, { sign: true }))}</b></div>
        </div>
        <div class="flow-bars" aria-hidden="true">
          <span class="fb fb-in" style="width:${((d.income / flowMax) * 100).toFixed(1)}%"></span>
          <span class="fb fb-out" style="width:${((d.expense / flowMax) * 100).toFixed(1)}%"></span>
        </div>
        ${sparkline(d.daily, d.month)}
        <p class="muted small">${spendDelta == null ? 'Daily spending this month' : `Spending is <b class="${spendDelta > 0 ? 'text-danger' : 'text-ok'}">${spendDelta > 0 ? '▲' : '▼'} ${Math.abs(spendDelta)}%</b> vs all of last month`}</p>
      </section>

      <section class="card cats-card">
        <div class="card-head"><h2>Top spending</h2><a href="#/reports" class="link">Reports</a></div>
        ${top.length ? `<ul class="cat-bars">
          ${top.map(([name, amt]) => {
            const c = cats.get(name);
            const color = hashColor(name);
            return `<li>
              <span class="cb-ic" style="--tint:${color}">${esc(c?.icon || '🏷️')}</span>
              <span class="cb-main">
                <span class="cb-row"><span>${esc(name)}</span><b>${esc(money(amt))}</b></span>
                <span class="cb-track"><span style="width:${((amt / topMax) * 100).toFixed(1)}%;background:${color}"></span></span>
              </span>
            </li>`;
          }).join('')}
        </ul>` : emptyState({ title: 'No spending yet', text: 'Expenses this month show up here.', iconName: 'chart' })}
      </section>
    </div>

    <section class="card recent-card">
      <div class="card-head"><h2>Recent</h2><a href="#/transactions" class="link">See all</a></div>
      <div class="txn-list">
        ${d.recent.length ? d.recent.map((t) => txnRow(t, { cats, wallets: wmap, showDate: true })).join('') : emptyState({ title: 'Nothing here yet', text: 'Tap + to add your first entry.', iconName: 'sparkle', action: '<a class="btn btn-primary" href="#/add">Add entry</a>' })}
      </div>
    </section>
  </div>`;
}

function skeleton() {
  return `
  <div class="page dash" aria-busy="true">
    <section class="hero"><span class="skel skel-line w30"></span><span class="skel skel-hero"></span><span class="skel skel-line w50"></span></section>
    <div class="wallet-strip">${'<span class="wcard skel"></span>'.repeat(3)}</div>
    <div class="dash-grid"><div class="card"><span class="skel skel-block"></span></div><div class="card"><span class="skel skel-block"></span></div></div>
    <div class="card">${skeletonRows(4)}</div>
  </div>`;
}

export default {
  async mount(el, ctx) {
    let data = state.dash;

    const paint = () => {
      if (!data) return;
      const d = withLocal(data, state.queue.items || []);
      el.innerHTML = view(d);
      el.querySelectorAll('.txn').forEach((b) =>
        b.addEventListener('click', () => {
          const t = d.recent.find((x) => x.id === b.dataset.id);
          if (t) openTxnDetail(t, { go: ctx.go, onDeleted: paint });
        }),
      );
    };

    const load = async () => {
      try {
        const fresh = await api('getDashboard', { month: monthKey() });
        if (!ctx.isCurrent()) return;
        data = fresh;
        state.dash = fresh;
        remember(fresh.recent);
        kvSet('dashboard', fresh);
        paint();
      } catch (err) {
        if (!ctx.isCurrent()) return;
        handleError(err, { silent: !!data });
        if (!data) {
          el.innerHTML = `<div class="page">${emptyState({
            title: navigator.onLine ? "Couldn't load your dashboard" : "You're offline",
            text: navigator.onLine ? 'Check your connection and try again.' : 'Connect once to load your data. You can still add entries.',
            iconName: navigator.onLine ? 'alert' : 'cloud-off',
            action: '<button type="button" class="btn btn-primary" id="retry">Try again</button> <a class="btn btn-ghost" href="#/add">Add entry</a>',
          })}</div>`;
          el.querySelector('#retry')?.addEventListener('click', () => {
            el.innerHTML = skeleton();
            load();
          });
        }
      }
    };

    if (data && data.month !== monthKey()) data = null;
    if (data) paint();
    else el.innerHTML = skeleton();
    load();

    ctx.on('queue', paint);
    ctx.on('boot', paint);
    ctx.on('synced', load);
    ctx.on('refresh', load);
    ctx.on('reauthed', load);
  },
};

