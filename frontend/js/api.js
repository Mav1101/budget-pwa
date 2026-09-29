// fetch wrapper for the Apps Script backend.
// Sent as text/plain (a "simple" CORS request, so no preflight, which Apps Script can't answer).
import { CONFIG } from './config.js';
import { getToken, refresh } from './auth.js';

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const RETRYABLE = new Set(['NETWORK', 'TIMEOUT', 'HTTP', 'BAD_RESPONSE', 'BUSY', 'SERVER_ERROR', 'AUTH_UNAVAILABLE']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls a backend action. Retries network hiccups with backoff, and refreshes
 * the Google token once if the server says it expired.
 * Writes are safe to retry: entry IDs are generated on the device.
 */
export async function api(action, payload = {}, { retries = 2, timeout = 35000 } = {}) {
  if (!navigator.onLine) throw new ApiError('OFFLINE');
  let token;
  try {
    token = await getToken();
  } catch (e) {
    throw new ApiError(e.code || 'INTERACTION_REQUIRED');
  }

  let authRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(action, payload, token, timeout);
    } catch (err) {
      if ((err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED') && !authRetried) {
        authRetried = true;
        try {
          token = await refresh();
        } catch {
          throw new ApiError('INTERACTION_REQUIRED');
        }
        attempt--;
        continue;
      }
      if (RETRYABLE.has(err.code) && attempt < retries && navigator.onLine) {
        await sleep(700 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      throw err;
    }
  }
}

async function once(action, payload, idToken, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, idToken, payload }),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError('HTTP', `HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE');
  }
  if (json && json.ok) return json.data;
  throw new ApiError((json && json.error) || 'SERVER_ERROR', json && json.message);
}
