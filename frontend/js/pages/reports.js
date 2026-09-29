import { api } from '../api.js';
import { kvGet, kvSet } from '../offline.js';
import { handleError, categoryMap } from '../store.js';
import { esc, icon, money, monthLabel, emptyState, hashColor, round2 } from '../ui.js';
import { whenChartReady, themeColors, baseOptions, compactPeso } from '../charts.js';

export default {
  async mount(el, ctx) {
    let range = Number(ctx.query.months) || 6;
    let donutMonth = 'all';
    let donutKind = 'expense';
    let data = null;
    let charts = [];

    el.innerHTML = `
      <div class="page reports">
        <header class="page-head">
          <h1>Reports</h1>
          <div class="seg seg-sm" role="radiogroup" aria-label="Range" id="range">
            ${[3, 6, 12].map((n) => `<button type="button" role="radio" data-n="${n}">${n}M</button>`).join('')}
          </div>
        </header>
        <div id="body"><div class="stat-grid">${'<div class="stat"><span class="skel skel-line w40"></span><span class="skel skel-line w60"></span></div>'.repeat(4)}</div>
        <div class="card"><span class="skel skel-block tall"></span></div></div>
      </div>`;
    const body = el.querySelector('#body');

    const destroyCharts = () => {
      charts.forEach((c) => c.destroy());
      charts = [];
    };
    ctx.onCleanup(destroyCharts);

    function paintRange() {
      el.querySelectorAll('#range [data-n]').forEach((b) => {
        const on = Number(b.dataset.n) === range;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
      });
    }

    function categoryTotals() {
      const src = donutKind === 'expense' ? data.expenseByCategory : data.incomeByCategory;
      const totals = {};
      const months = donutMonth === 'all' ? data.months : [donutMonth];
      months.forEach((m) => Object.entries(src[m] || {}).forEach(([k, v]) => (totals[k] = round2((totals[k] || 0) + v))));
      return Object.entries(totals).sort((a, b) => b[1] - a[1]);
    }

    async function paint() {
      destroyCharts();
      if (!data) return;
      const inc = data.income.reduce((a, b) => a + b, 0);
      const exp = data.expense.reduce((a, b) => a + b, 0);
      const net = inc - exp;
      const rate = inc > 0 ? Math.round((net / inc) * 100) : null;
      const avg = exp / data.months.length;
      const hasAny = inc > 0 || exp > 0;
      const cats = categoryMap();
      const catRows = categoryTotals();
      const catSum = catRows.reduce((s, [, v]) => s + v, 0);

      body.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><small>Income</small><b class="amt-in">${esc(money(inc, { compact: true }))}</b></div>
          <div class="stat"><small>Spent</small><b class="amt-out">${esc(money(exp, { compact: true }))}</b></div>
          <div class="stat"><small>Saved</small><b class="${net >= 0 ? 'amt-in' : 'amt-out'}">${esc(money(net, { compact: true, sign: true }))}</b></div>
          <div class="stat"><small>Savings rate</small><b>${rate == null ? '—' : `${rate}%`}</b><span class="muted small">avg spend ${esc(money(avg, { compact: true }))}/mo</span></div>
        </div>
        ${hasAny ? '' : emptyState({ title: 'No data in this range', text: 'Add entries or pick a longer range.', iconName: 'chart' })}
        <section class="card chart-card">
          <div class="card-head"><h2>Income vs spending</h2>
            <span class="legend"><i style="background:var(--income)"></i>Income <i style="background:var(--expense)"></i>Spent <i class="line" style="background:var(--ink-2)"></i>Net</span></div>
          <div class="chart-box"><canvas id="c-flow" aria-label="Monthly income and spending" role="img"></canvas></div>
        </section>
        <div class="dash-grid">
          <section class="card chart-card">
            <div class="card-head"><h2>By category</h2>
              <div class="seg seg-xs" role="radiogroup" aria-label="Kind" id="kind">
                <button type="button" role="radio" data-k="expense">Spent</button><button type="button" role="radio" data-k="income">Income</button>
              </div>
            </div>
            <div class="chips chips-scroll month-chips" id="dm">
              <button type="button" class="chip chip-sm" data-m="all">All ${data.months.length} months</button>
              ${[...data.months].reverse().map((m) => `<button type="button" class="chip chip-sm" data-m="${m}">${esc(monthLabel(m, 'shortYear'))}</button>`).join('')}
            </div>
            ${catRows.length ? `
            <div class="donut-wrap">
              <div class="chart-box donut"><canvas id="c-donut" aria-label="Category breakdown" role="img"></canvas>
                <div class="donut-center"><small>${donutKind === 'expense' ? 'Spent' : 'Income'}</small><b>${esc(money(catSum, { compact: true }))}</b></div></div>
              <ul class="donut-legend">
                ${catRows.slice(0, 8).map(([name, v]) => `<li><i style="background:${hashColor(name)}"></i><span>${esc(cats.get(name)?.icon || '')} ${esc(name)}</span><b>${esc(money(v, { compact: true }))}</b><small>${catSum ? Math.round((v / catSum) * 100) : 0}%</small></li>`).join('')}
                ${catRows.length > 8 ? `<li class="muted"><i></i><span>+${catRows.length - 8} more</span></li>` : ''}
              </ul>
            </div>` : `<p class="muted center pad">Nothing in this period.</p>`}
          </section>
          <section class="card chart-card">
            <div class="card-head"><h2>Wallet balances</h2><span class="muted small">end of month</span></div>
            <div class="chart-box"><canvas id="c-wallets" aria-label="Wallet balance trend" role="img"></canvas></div>
            <div class="legend legend-wrap">${data.walletTrend.map((w) => `<span><i style="background:${esc(w.color)}"></i>${esc(w.name)}</span>`).join('')}</div>
          </section>
        </div>`;

      body.querySelectorAll('#kind [data-k]').forEach((b) => {
        const on = b.dataset.k === donutKind;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
        b.addEventListener('click', () => {
          donutKind = b.dataset.k;
          paint();
        });
      });
      body.querySelectorAll('#dm [data-m]').forEach((b) => {
        b.classList.toggle('on', b.dataset.m === donutMonth);
        b.addEventListener('click', () => {
          donutMonth = b.dataset.m;
          paint();
        });
      });

      let Chart;
      try {
        Chart = await whenChartReady();
      } catch {
        body.querySelectorAll('.chart-box:not(.donut)').forEach((b) => (b.innerHTML = `<p class="muted center pad">${icon('cloud-off')} Charts need a connection the first time.</p>`));
        return;
      }
      if (!ctx.isCurrent() || !body.querySelector('#c-flow')) return;
      const c = themeColors();
      const labels = data.months.map((m) => monthLabel(m, 'short'));
      const money2 = (v) => money(v);

      charts.push(new Chart(body.querySelector('#c-flow'), {
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Income', data: data.income, backgroundColor: c.income, borderRadius: 6, maxBarThickness: 22, order: 2 },
            { type: 'bar', label: 'Spent', data: data.expense, backgroundColor: c.expense, borderRadius: 6, maxBarThickness: 22, order: 2 },
            { type: 'line', label: 'Net', data: data.net, borderColor: c.ink2, backgroundColor: c.ink2, borderWidth: 2, pointRadius: 3, tension: 0.35, cubicInterpolationMode: 'monotone', order: 1 },
          ],
        },
        options: {
          ...baseOptions(c),
          plugins: { ...baseOptions(c).plugins, tooltip: { ...baseOptions(c).plugins.tooltip, callbacks: { label: (i) => `${i.dataset.label}: ${money2(i.raw)}` } } },
        },
      }));

      const donutEl = body.querySelector('#c-donut');
      if (donutEl) {
        charts.push(new Chart(donutEl, {
          type: 'doughnut',
          data: {
            labels: catRows.map(([n]) => n),
            datasets: [{ data: catRows.map(([, v]) => v), backgroundColor: catRows.map(([n]) => hashColor(n)), borderColor: c.surface, borderWidth: 3, hoverOffset: 6 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { legend: { display: false }, tooltip: { ...baseOptions(c).plugins.tooltip, callbacks: { label: (i) => `${i.label}: ${money2(i.raw)}` } } },
          },
        }));
      }

      const wopts = baseOptions(c);
      charts.push(new Chart(body.querySelector('#c-wallets'), {
        type: 'line',
        data: {
          labels,
          datasets: data.walletTrend.map((w) => ({
            label: w.name, data: w.values, borderColor: w.color, backgroundColor: w.color, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, cubicInterpolationMode: 'monotone',
          })),
        },
        options: {
          ...wopts,
          scales: { ...wopts.scales, y: { ...wopts.scales.y, ticks: { ...wopts.scales.y.ticks, callback: compactPeso } } },
          plugins: { ...wopts.plugins, tooltip: { ...wopts.plugins.tooltip, callbacks: { label: (i) => `${i.dataset.label}: ${money2(i.raw)}` } } },
        },
      }));
    }

    async function load() {
      paintRange();
      const key = `reports:${range}`;
      if (!data) {
        const cached = await kvGet(key);
        if (cached && ctx.isCurrent()) {
          data = cached;
          paint();
        }
      }
      try {
        const r = await api('getReports', { months: range });
        if (!ctx.isCurrent()) return;
        data = r;
        kvSet(key, r);
        if (donutMonth !== 'all' && !r.months.includes(donutMonth)) donutMonth = 'all';
        paint();
      } catch (err) {
        if (!ctx.isCurrent()) return;
        handleError(err, { silent: !!data });
        if (!data) body.innerHTML = emptyState({ title: navigator.onLine ? "Couldn't load reports" : "You're offline", text: 'Reports load when you are online.', iconName: navigator.onLine ? 'alert' : 'cloud-off' });
      }
    }

    el.querySelectorAll('#range [data-n]').forEach((b) =>
      b.addEventListener('click', () => {
        range = Number(b.dataset.n);
        ctx.setQuery({ months: range });
        data = null;
        load();
      }),
    );
    ctx.on('theme', paint);
    ctx.on('synced', load);
    ctx.on('refresh', load);
    ctx.on('reauthed', load);
    await load();
  },
};
