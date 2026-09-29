// Chart.js helpers (Chart.js is loaded from cdnjs in index.html and cached by the service worker).

export function whenChartReady(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.Chart) return resolve(window.Chart);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('Chart.js unavailable'));
      setTimeout(poll, 80);
    })();
  });
}

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    line: v('--line'),
    surface: v('--surface'),
    income: v('--income'),
    expense: v('--expense'),
    transfer: v('--transfer'),
    accent: v('--accent'),
    font: v('--font-ui') || 'system-ui',
  };
}

export function baseOptions(c) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 450 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.ink,
        titleColor: c.surface,
        bodyColor: c.surface,
        padding: 10,
        cornerRadius: 10,
        boxPadding: 4,
        titleFont: { family: c.font, weight: '600' },
        bodyFont: { family: c.font },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: c.ink3, font: { family: c.font, size: 11 } },
      },
      y: {
        grid: { color: c.line, drawTicks: false },
        border: { display: false },
        ticks: {
          color: c.ink3,
          padding: 8,
          font: { family: c.font, size: 11 },
          callback: (v) => compactPeso(v),
          maxTicksLimit: 5,
        },
      },
    },
  };
}

export function compactPeso(v) {
  const n = Math.abs(v);
  const s = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : `${Math.round(n)}`;
  return `${v < 0 ? '−' : ''}₱${s}`;
}
