// Google Identity Services sign-in.
// ID tokens last about an hour. We refresh them silently (One Tap auto-select
// / FedCM) a few minutes before they expire, and again if the server says a
// token is expired. If Google needs you to click, the app shows a small
// "Continue" banner. It never shows a raw error.
import { CONFIG } from './config.js';

const KEY = 'budget.auth.v1';
const REFRESH_TIMEOUT_MS = 10000;
// After a failed silent refresh, don't prompt Google again for a while (the app shows a Continue button instead).
const FAIL_COOLDOWN_MS = 60000;

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

let cred = null; // { token, exp (ms), email, name, picture }
let initialized = false;
let refreshing = null;
let lastFailure = 0;
let waiters = [];
const listeners = new Set();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.email) cred = s;
  } catch {
    cred = null;
  }
}
load();

function persist() {
  try {
    if (cred) localStorage.setItem(KEY, JSON.stringify(cred));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: stay signed in for this session only */
  }
}

function decodeJwt(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(part + '==='.slice((part.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function onCredential(resp) {
  if (!resp || !resp.credential) return;
  let claims;
  try {
    claims = decodeJwt(resp.credential);
  } catch {
    return;
  }
  lastFailure = 0;
  cred = {
    token: resp.credential,
    exp: (claims.exp || 0) * 1000,
    email: String(claims.email || '').toLowerCase(),
    name: claims.given_name || claims.name || claims.email || '',
    fullName: claims.name || '',
    picture: claims.picture || '',
  };
  persist();
  const w = waiters;
  waiters = [];
  w.forEach((fn) => fn(cred.token));
  listeners.forEach((fn) => fn(currentUser()));
}

export function currentUser() {
  return cred ? { email: cred.email, name: cred.name, fullName: cred.fullName, picture: cred.picture } : null;
}

export function onSignIn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tokenValid(marginMs = 90_000) {
  return !!(cred && cred.token && cred.exp - marginMs > Date.now());
}

export function whenGisReady(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.google?.accounts?.id) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new AuthError('GIS_UNAVAILABLE'));
      setTimeout(poll, 100);
    })();
  });
}

async function init() {
  if (initialized) return;
  await whenGisReady();
  window.google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
    itp_support: true,
    use_fedcm_for_prompt: true,
    login_hint: cred?.email || undefined,
  });
  initialized = true;
}

/** Renders the official Google button into `el`. */
export async function renderButton(el, { dark = false } = {}) {
  await init();
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, {
    type: 'standard',
    theme: dark ? 'filled_black' : 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    logo_alignment: 'left',
    width: Math.max(220, Math.min(el.clientWidth || 320, 360)),
  });
}

/** Shows One Tap (used on the sign-in screen). */
export async function promptOneTap() {
  try {
    await init();
    window.google.accounts.id.prompt();
  } catch {
    /* the button is still there */
  }
}

/** Returns a valid ID token, refreshing silently if needed. */
export async function getToken() {
  if (tokenValid()) return cred.token;
  return refresh();
}

export function recentlyFailed() {
  return Date.now() - lastFailure < FAIL_COOLDOWN_MS;
}

/** Silent re-auth. Rejects with INTERACTION_REQUIRED if Google wants a click. */
export function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  if (!force && recentlyFailed()) return Promise.reject(new AuthError('INTERACTION_REQUIRED'));
  refreshing = new Promise((resolve, reject) => {
    let settled = false;
    const waiter = (token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      waiters = waiters.filter((w) => w !== waiter);
      reject(new AuthError('INTERACTION_REQUIRED'));
    }, REFRESH_TIMEOUT_MS);
    waiters.push(waiter);
    init()
      .then(() => window.google.accounts.id.prompt())
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters = waiters.filter((w) => w !== waiter);
        reject(new AuthError('INTERACTION_REQUIRED'));
      });
  })
    .catch((err) => {
      lastFailure = Date.now();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function signOut() {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* ignore */
  }
  cred = null;
  persist();
}

/** Keeps the token fresh while the app is open and visible. */
export function startAutoRefresh() {
  const tick = () => {
    if (!cred || document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (!tokenValid(5 * 60_000)) refresh().catch(() => {});
  };
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', tick);
}
