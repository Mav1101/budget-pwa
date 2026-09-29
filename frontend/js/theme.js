// Light / dark / auto theme. The saved choice is applied before first paint by
// an inline script in index.html; this module handles changes afterwards.
import { bus } from './ui.js';

const KEY = 'budget.theme';
const media = matchMedia('(prefers-color-scheme: dark)');

export function themeMode() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function isDark() {
  const m = themeMode();
  return m === 'dark' || (m === 'auto' && media.matches);
}

export function setThemeMode(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable: applies for this session */
  }
  applyTheme();
}

export function applyTheme() {
  const m = themeMode();
  const root = document.documentElement;
  if (m === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', m);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || (isDark() ? '#0E1013' : '#F4F0E6'));
  bus.emit('theme', { mode: m, dark: isDark() });
}

media.addEventListener('change', () => {
  if (themeMode() === 'auto') applyTheme();
});
