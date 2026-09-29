/**
 * Phone notification webhook (for MacroDroid). DISABLED BY DEFAULT.
 * Turn it on and copy the token in the app: Settings → Phone notifications.
 *
 * MacroDroid sends an HTTP POST to the web app URL, either JSON:
 *   { "action": "webhook", "token": "<WEBHOOK_TOKEN>", "app": "GCash",
 *     "title": "[not_title]", "text": "[notification]" }
 * or the same keys as form fields (safer when the text contains quotes).
 *
 * The token is NOT a Google sign-in: it lives only in Script Properties
 * (WEBHOOK_TOKEN) and can be regenerated from Settings. Parsed entries land as
 * Pending (Source = "Webhook"); texts that don't match are logged as
 * "Unparsed" in EmailLog so you can tune the rules below.
 */

/* ╔══════════════════════════════════════════════════════════════════╗
 * ║  WEBHOOK_PARSER — rules for GCash / Maya / Landbank notifications   ║
 * ║  Same tokens as WISE_PARSER ({MONEY}, {PARTY}, {END}).              ║
 * ║  Amounts without a currency are treated as PHP ("P500.00" works).   ║
 * ║  These are starting patterns: check EmailLog → Unparsed and adjust. ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
const WEBHOOK_PARSER = {
  // Lower-case app name (or part of it) → wallet name on your Wallets sheet.
  walletAliases: {
    gcash: 'GCash', 'com.globe.gcash.android': 'GCash',
    maya: 'Maya', paymaya: 'Maya', 'com.paymaya': 'Maya',
    landbank: 'Landbank', lbp: 'Landbank', iaccess: 'Landbank',
    wise: 'Wise'
  },
  defaultCategory: { Income: 'Other Income', Expense: 'Other Expense' },
  currencies: ['PHP', 'USD', 'EUR', 'GBP'],
  symbols: { '₱': 'PHP', 'P': 'PHP', '$': 'USD' },
  // Identical notifications arriving within this many seconds are treated as one.
  dedupeSeconds: 120,
  rules: [
    { name: 'Received from', type: 'Income', pattern: '(?:you(?: have)? received|received) {MONEY}[^.\\n]*? from {PARTY}{END}' },
    { name: 'Received', type: 'Income', pattern: '(?:you(?: have)? received|received|cash[- ]in of|deposit(?:ed)? of) {MONEY}' },
    { name: 'Credited', type: 'Income', pattern: 'credited(?: with| for)? {MONEY}' },
    { name: 'Credited (amount first)', type: 'Income', pattern: '{MONEY} (?:has been |was )?(?:credited|received|deposited)' },
    { name: 'Paid to', type: 'Expense', pattern: '(?:you(?: have)? paid|payment of|purchase of) {MONEY}[^.\\n]*? (?:to|at) {PARTY}{END}' },
    { name: 'Sent to', type: 'Expense', pattern: '(?:you(?: have)? (?:sent|transferred)|sent) {MONEY}[^.\\n]*? to {PARTY}{END}' },
    { name: 'Paid / sent', type: 'Expense', pattern: '(?:you(?: have)? (?:paid|sent|transferred)|payment of|purchase of) {MONEY}' },
    { name: 'Debited', type: 'Expense', pattern: '(?:debited(?: with| for)?|withdrawal of|withdrew|cash[- ]out of) {MONEY}' },
    { name: 'Debited (amount first)', type: 'Expense', pattern: '{MONEY} (?:has been |was )?(?:debited|deducted|withdrawn|charged)' }
  ]
};

/** Called by the router for action "webhook". Always returns a small JSON object. */
function handleWebhook_(req) {
  try {
    // Token first, so an attacker learns nothing (not even whether the webhook is enabled).
    const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN') || '';
    if (!expected || !safeEqual_(String(req.token || ''), expected)) return { ok: false, error: 'AUTH_DENIED' };
    if (getSettings_().webhookEnabled !== 'true') return { ok: false, error: 'WEBHOOK_DISABLED' };
    return withLock_(function () { return ingestNotification_(req); });
  } catch (err) {
    if (err && err.appCode) return { ok: false, error: err.appCode };
    console.error('Webhook failed: ' + ((err && err.stack) || err));
    return { ok: false, error: 'SERVER_ERROR' };
  }
}

function walletForApp_(app, text) {
  const aliases = WEBHOOK_PARSER.walletAliases;
  const a = String(app || '').trim().toLowerCase();
  if (aliases[a]) return aliases[a];
  const keys = Object.keys(aliases).sort(function (x, y) { return y.length - x.length; });
  for (let i = 0; i < keys.length; i++) {
    if (a && a.indexOf(keys[i]) >= 0) return aliases[keys[i]];
  }
  const t = String(text || '').toLowerCase();
  for (let j = 0; j < keys.length; j++) {
    if (/^[a-z]+$/.test(keys[j]) && new RegExp('\\b' + keys[j] + '\\b').test(t)) return aliases[keys[j]];
  }
  return cleanName_(app) || 'Unknown';
}

function ingestNotification_(req) {
  const cfg = WEBHOOK_PARSER;
  const title = normalizeText_(req.title || '').slice(0, 200);
  const body = normalizeText_(req.text || req.message || '').slice(0, 2000);
  if (!body && !title) return { ok: false, error: 'BAD_REQUEST' };
  const text = body || title;
  const app = String(req.app || req.wallet || '').slice(0, 80);
  const wallet = walletForApp_(app, title + ' ' + text);

  // MacroDroid can fire twice for one notification: ignore repeats for a short while.
  const fingerprint = sha256Hex_(wallet + '|' + title + '|' + text).slice(0, 32);
  const cache = CacheService.getScriptCache();
  if (cache.get('wh:' + fingerprint)) return { ok: true, data: { status: 'duplicate' } };
  cache.put('wh:' + fingerprint, '1', cfg.dedupeSeconds);

  const now = new Date();
  const logId = 'webhook:' + fingerprint + ':' + now.getTime().toString(36);
  const subject = '[' + wallet + '] ' + (title ? title + ': ' : '') + text.slice(0, 200);
  const compiled = compileRules_(cfg.rules, cfg.currencies, cfg.symbols);
  const hit = matchRules_(compiled, [text, title + ' ' + text], cfg.currencies, cfg.symbols, BASE_CURRENCY);

  if (!hit) {
    appendObjects_('EmailLog', [{
      messageId: logId, threadId: '', emailDate: now, subject: cellText_(subject, 250), status: 'Unparsed',
      transactionId: '', detail: cellText_(text, 300), loggedAt: now, source: 'Webhook'
    }]);
    return { ok: true, data: { status: 'unparsed' } };
  }

  const conv = toPhp_(hit, {});
  let day = todayIso_();
  if (req.time) {
    const d = new Date(req.time);
    if (!isNaN(d) && Math.abs(d - now) < 7 * 86400000) day = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  }
  const x = {
    id: Utilities.getUuid(),
    date: day,
    wallet: wallet,
    type: hit.type,
    amount: conv.php,
    originalAmount: hit.amount,
    originalCurrency: hit.currency,
    category: categoryFor_(hit.type, hit.counterparty, cfg.defaultCategory),
    toWallet: '',
    note: ((hit.counterparty ? (hit.type === 'Income' ? 'From ' : 'To ') + hit.counterparty + ' · ' : '') + text).slice(0, 500),
    source: 'Webhook',
    status: 'Pending',
    createdAt: now,
    updatedAt: now
  };
  appendObjects_('Transactions', [txnFields_(x)]);
  appendObjects_('EmailLog', [{
    messageId: logId, threadId: '', emailDate: now, subject: cellText_(subject, 250), status: 'Parsed',
    transactionId: x.id, detail: hit.rule, loggedAt: now, source: 'Webhook'
  }]);
  return { ok: true, data: { status: 'pending', id: x.id } };
}
