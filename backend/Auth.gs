/**
 * Google ID token verification.
 *
 * The app signs in with Google Identity Services and sends the ID token (a JWT)
 * with every request. We ask Google's tokeninfo endpoint to validate it, then
 * check that:
 *   - aud   == GOOGLE_CLIENT_ID          (token was issued for this app)
 *   - iss   == accounts.google.com
 *   - exp   is in the future
 *   - email_verified is true
 *   - email == ALLOWED_EMAIL             (only you)
 * Successful checks are cached for up to 5 minutes, keyed by a SHA-256 hash
 * of the token (the token itself is never stored).
 *
 * Script Properties used: ALLOWED_EMAIL, GOOGLE_CLIENT_ID.
 */

const TOKENINFO_URL_ = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const AUTH_CACHE_SECONDS_ = 300;

function verifyIdToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) {
    return { ok: false, error: 'AUTH_REQUIRED' };
  }

  const props = PropertiesService.getScriptProperties();
  const allowed = String(props.getProperty('ALLOWED_EMAIL') || '').trim().toLowerCase();
  const clientId = String(props.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  if (!allowed || !clientId) return { ok: false, error: 'SERVER_NOT_CONFIGURED' };

  const cache = CacheService.getScriptCache();
  const key = 'auth:' + sha256Hex_(token);
  const nowSec = Math.floor(Date.now() / 1000);

  const hit = cache.get(key);
  if (hit) {
    try {
      const c = JSON.parse(hit);
      if (c.exp > nowSec && c.email === allowed) return { ok: true, email: c.email };
    } catch (err) { /* corrupt cache entry: verify again */ }
  }

  let info;
  try {
    const res = UrlFetchApp.fetch(TOKENINFO_URL_ + encodeURIComponent(token), { muteHttpExceptions: true });
    const code = res.getResponseCode();
    // tokeninfo answers 400 for expired, malformed or tampered tokens.
    if (code === 400 || code === 401) return { ok: false, error: 'AUTH_EXPIRED' };
    if (code !== 200) return { ok: false, error: 'AUTH_UNAVAILABLE' };
    info = JSON.parse(res.getContentText());
  } catch (err) {
    return { ok: false, error: 'AUTH_UNAVAILABLE' };
  }

  const exp = Number(info.exp) || 0;
  if (exp <= nowSec) return { ok: false, error: 'AUTH_EXPIRED' };
  if (info.aud !== clientId) return { ok: false, error: 'AUTH_DENIED' };
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    return { ok: false, error: 'AUTH_DENIED' };
  }
  if (!(info.email_verified === true || info.email_verified === 'true')) return { ok: false, error: 'AUTH_DENIED' };
  const email = String(info.email || '').toLowerCase();
  if (email !== allowed) return { ok: false, error: 'AUTH_DENIED' };

  const ttl = Math.min(AUTH_CACHE_SECONDS_, exp - nowSec);
  if (ttl > 5) cache.put(key, JSON.stringify({ email: email, exp: exp }), ttl);
  return { ok: true, email: email };
}

function authMessage_(code) {
  switch (code) {
    case 'AUTH_REQUIRED': return 'Please sign in.';
    case 'AUTH_EXPIRED': return 'Your session expired. Please sign in again.';
    case 'AUTH_DENIED': return 'This Google account is not allowed to use this app.';
    case 'AUTH_UNAVAILABLE': return 'Could not reach Google to verify your sign-in. Try again.';
    case 'SERVER_NOT_CONFIGURED': return 'The server is not configured yet. Set ALLOWED_EMAIL and GOOGLE_CLIENT_ID in Script Properties.';
    default: return 'Sign-in failed.';
  }
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

/** Constant-time string comparison (for the webhook token). */
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
