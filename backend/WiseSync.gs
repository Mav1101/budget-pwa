/**
 * Wise email sync (Gmail, READ-ONLY).
 * Searches Gmail for Wise notifications, parses them and adds Pending entries
 * for review. It never labels, archives, modifies or deletes an email.
 *
 * Dedupe:
 *   - every Gmail message ID is written to EmailLog, so an email is processed once
 *     (even after you discard its entry)
 *   - the Wise Transfer Number is saved in the note ("Wise #123"), so a second
 *     email about the same transfer is skipped
 */

/* ╔══════════════════════════════════════════════════════════════════╗
 * ║  WISE_PARSER — EDIT THESE RULES TO MATCH YOUR EMAILS                ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Rules are tried in order against the BODY first, then the SUBJECT. ║
 * ║  The first rule that matches wins.                                  ║
 * ║                                                                     ║
 * ║  Tokens you can use inside a pattern:                               ║
 * ║    {MONEY}  an amount with currency: "10,226.97 PHP", "USD 25",     ║
 * ║             "$25.00", "₱500"   (required, exactly once)             ║
 * ║    {PARTY}  a short name, e.g. the sender or merchant (optional)    ║
 * ║    {END}    put right after {PARTY} when it ends the sentence       ║
 * ║  Use (?: … ) for your own groups — plain ( … ) groups break the     ║
 * ║  token numbering. Matching ignores upper/lower case.                ║
 * ║                                                                     ║
 * ║  type: 'Income' | 'Expense' | 'Transfer'                            ║
 * ║    Transfer = money moved from Wise to another wallet of yours.     ║
 * ║    Pick the destination wallet when you review the entry, or set    ║
 * ║    transferToWallet below if it is always the same one.             ║
 * ║                                                                     ║
 * ║  After editing: Settings → Wise email sync → "Retry unparsed".      ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
const WISE_PARSER = {
  // Only messages whose From header matches this are processed.
  fromPattern: /wise\.com|transferwise/i,

  // Most emails looked at per run. Older ones are picked up on the next run.
  maxMessagesPerRun: 60,

  // Default wallet for Transfer entries parsed from Wise ('' = choose it during review).
  transferToWallet: '',

  // Default categories. Must match names on your Categories sheet.
  defaultCategory: { Income: 'Other Income', Expense: 'Other Expense', Fee: 'Fees & Charges' },

  // Counterparty → category. The key is matched as a case-insensitive substring.
  // Example: { 'WebForce Digital': 'Freelance', 'Grab': 'Transport' }
  // When nothing matches, the category you last approved for the same counterparty is reused.
  counterpartyCategories: {},

  // Record the "Wise fee" line of a Transfer as its own Expense entry.
  splitFees: true,

  // Currency codes recognised inside {MONEY}.
  currencies: ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'HKD', 'NZD', 'CHF', 'AED', 'SAR',
    'KRW', 'CNY', 'THB', 'MYR', 'IDR', 'VND', 'INR', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'MXN',
    'BRL', 'ZAR', 'TRY', 'QAR', 'KWD', 'TWD'],

  // Symbols recognised inside {MONEY} when there is no currency code.
  symbols: { 'US$': 'USD', 'S$': 'SGD', 'A$': 'AUD', 'C$': 'CAD', 'HK$': 'HKD', '$': 'USD', '₱': 'PHP', '€': 'EUR', '£': 'GBP', '¥': 'JPY' },

  // Subjects that are never transactions. Logged as "Skipped", not "Unparsed".
  ignoreSubjects: [
    /verif|security|sign(?:ed)? ?in|log ?in|password|passcode|new device/i,
    /statement|rate alert|exchange rate|survey|newsletter|webinar|terms|privacy|policy|update to our/i,
    /card (?:is|has been)? ?(?:on its way|shipped|activated|frozen|ordered)|convert|conversion/i,
    /cancel+ed|declined|failed|unsuccessful|refused|action (?:needed|required)|document|tax form/i
  ],

  // Extra labelled lines read from the body (each needs one capture group, or {MONEY}).
  fields: {
    transferNumber: 'Transfer Number:\\s*#?\\s*(\\d{5,})',
    reference: 'Reference:\\s*([^\\n]{1,80})',
    from: '(?:^|\\n)From:\\s*([^\\n]{1,80})',
    fee: 'Wise fee:\\s*{MONEY}',
    sentAmount: '(?:^|\\n)Amount:\\s*{MONEY}'
  },

  rules: [
    // ── Verified against your sample emails ─────────────────────────────
    // "You received 10,226.97 PHP from WebForce Digital."
    { name: 'Received from', type: 'Income', pattern: "you(?:'ve| have)? (?:just )?received {MONEY} from {PARTY}{END}" },
    // "500.80 PHP is now in your account."  (Amount: 540 PHP · Wise fee: 39.20 PHP)
    // → Transfer of 500.80 out of Wise + a separate 39.20 Fees & Charges expense.
    { name: 'Arrived in your account', type: 'Transfer', pattern: '{MONEY} (?:is|are) now in your account' },

    // ── Based on common Wise wording; not verified with your emails yet ──
    { name: 'Received', type: 'Income', pattern: "you(?:'ve| have)? (?:just )?received {MONEY}" },
    { name: 'Sent you', type: 'Income', pattern: '{PARTY} (?:has )?(?:sent|paid) you {MONEY}' },
    { name: 'Card payment', type: 'Expense', pattern: '(?:you|your card) (?:spent|paid|was charged) {MONEY} (?:at|to|on) {PARTY}{END}' },
    { name: 'Sent money', type: 'Expense', pattern: "you(?:'ve| have)? sent {MONEY} to {PARTY}{END}" },
    { name: 'Now in their account', type: 'Expense', pattern: "{MONEY} (?:is|are) now in {PARTY}(?:'s)? account" },
    { name: 'Transfer to', type: 'Expense', pattern: 'transfer of {MONEY} to {PARTY}{END}' },
    { name: 'Direct debit', type: 'Expense', pattern: '(?:direct debit|payment) of {MONEY} (?:to|for) {PARTY}{END}' },
    { name: 'Refund', type: 'Income', pattern: 'refund(?:ed)?(?: of)? {MONEY}' }
  ]
};

// ════════════════════════════════════════════════════════════════════
//  Rule engine (shared with Webhook.gs)
// ════════════════════════════════════════════════════════════════════
function escapeRegex_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function moneyToken_(currencies, symbols) {
  const cur = '(?:' + currencies.join('|') + ')';
  const syms = Object.keys(symbols).sort(function (a, b) { return b.length - a.length; }).map(escapeRegex_);
  const sym = syms.length ? '(?:' + syms.join('|') + ')?' : '';
  return '((?:' + cur + '\\s?)?' + sym + '\\s?\\d[\\d,]*(?:\\.\\d{1,2})?(?:\\s?' + cur + '\\b)?)';
}

const PARTY_TOKEN_ = '([^.,!?\\n(]{1,60}?)';
const END_TOKEN_ = '(?=\\s*(?:[.,!?(\\n]|$))';

function compileRules_(rules, currencies, symbols) {
  const money = moneyToken_(currencies, symbols);
  return rules.map(function (r) {
    const p = r.pattern;
    const mi = p.indexOf('{MONEY}');
    const pi = p.indexOf('{PARTY}');
    const src = p.replace('{MONEY}', money).replace('{PARTY}', PARTY_TOKEN_).split('{END}').join(END_TOKEN_);
    return {
      name: r.name,
      type: r.type,
      re: new RegExp(src, 'i'),
      moneyGroup: pi >= 0 && pi < mi ? 2 : 1,
      partyGroup: pi < 0 ? 0 : (pi < mi ? 1 : 2)
    };
  });
}

/** "10,226.97 PHP" -> {amount: 10226.97, currency: 'PHP'}; null if unreadable. */
function parseMoney_(s, currencies, symbols, fallbackCurrency) {
  const text = String(s || '').replace(/ /g, ' ');
  const up = text.toUpperCase();
  let cur = '';
  for (let i = 0; i < currencies.length; i++) {
    if (new RegExp('(^|[^A-Z])' + currencies[i] + '([^A-Z]|$)').test(up)) { cur = currencies[i]; break; }
  }
  if (!cur) {
    const keys = Object.keys(symbols).sort(function (a, b) { return b.length - a.length; });
    for (let j = 0; j < keys.length; j++) {
      if (up.indexOf(keys[j].toUpperCase()) >= 0) { cur = symbols[keys[j]]; break; }
    }
  }
  if (!cur) cur = fallbackCurrency || '';
  const m = text.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m || !cur) return null;
  const amount = Number(m[0].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  return { amount: round2_(amount), currency: cur };
}

function normalizeText_(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Runs compiled rules over the given texts (in order). Returns the first hit or null. */
function matchRules_(compiled, texts, currencies, symbols, fallbackCurrency) {
  for (let t = 0; t < texts.length; t++) {
    for (let i = 0; i < compiled.length; i++) {
      const rule = compiled[i];
      const m = rule.re.exec(texts[t]);
      if (!m) continue;
      const money = parseMoney_(m[rule.moneyGroup], currencies, symbols, fallbackCurrency);
      if (!money) continue;
      return {
        rule: rule.name,
        type: rule.type,
        amount: money.amount,
        currency: money.currency,
        counterparty: rule.partyGroup ? String(m[rule.partyGroup] || '').trim().slice(0, 80) : ''
      };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  Wise parsing
// ════════════════════════════════════════════════════════════════════
function parseWiseEmail_(subject, body) {
  const cfg = WISE_PARSER;
  const subj = normalizeText_(subject);
  const text = normalizeText_(body).slice(0, 20000);

  for (let i = 0; i < cfg.ignoreSubjects.length; i++) {
    if (cfg.ignoreSubjects[i].test(subj)) return { status: 'ignored', detail: 'Ignored subject' };
  }

  const hit = matchRules_(compileRules_(cfg.rules, cfg.currencies, cfg.symbols), [text, subj], cfg.currencies, cfg.symbols, '');
  if (!hit) return { status: 'unparsed', detail: text.slice(0, 160).replace(/\n/g, ' ') };

  const money = moneyToken_(cfg.currencies, cfg.symbols);
  const field = function (key) {
    const src = cfg.fields[key];
    if (!src) return null;
    const m = new RegExp(src.replace('{MONEY}', money), 'i').exec(text);
    return m ? m[1].trim() : null;
  };
  const feeText = field('fee');
  const sentText = field('sentAmount');
  hit.transferNumber = field('transferNumber') || '';
  hit.reference = field('reference') || '';
  if (!hit.counterparty) hit.counterparty = field('from') || '';
  hit.fee = feeText ? parseMoney_(feeText, cfg.currencies, cfg.symbols, hit.currency) : null;
  hit.sent = sentText ? parseMoney_(sentText, cfg.currencies, cfg.symbols, hit.currency) : null;
  hit.status = 'ok';
  return hit;
}

/** Category for a parsed entry: config map first, then what you last approved for the same counterparty. */
function categoryFor_(type, counterparty, defaults) {
  if (type === 'Transfer') return '';
  const cp = String(counterparty || '').trim().toLowerCase();
  if (cp) {
    const map = WISE_PARSER.counterpartyCategories;
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
      if (cp.indexOf(keys[i].toLowerCase()) >= 0) return map[keys[i]];
    }
    const learned = learnedCategory_(type, cp);
    if (learned) return learned;
  }
  return (defaults || WISE_PARSER.defaultCategory)[type] || '';
}

function learnedCategory_(type, cpLower) {
  if (cpLower.length < 3) return '';
  if (!MEMO_.learned) {
    const map = {};
    sortTxnsDesc_(readTxns_().filter(function (x) {
      return x.status === 'Confirmed' && x.source !== 'Manual' && x.category;
    }).slice()).reverse().forEach(function (x) {
      const m = /^(?:From|To) ([^·]+?)\s*(?:·|$)/.exec(x.note);
      if (m) map[x.type + '|' + m[1].trim().toLowerCase()] = x.category;
    });
    MEMO_.learned = map;
  }
  return MEMO_.learned[type + '|' + cpLower] || '';
}

// ════════════════════════════════════════════════════════════════════
//  Currency conversion via the GOOGLEFINANCE helper (Settings!D2:E2)
// ════════════════════════════════════════════════════════════════════
function getFxRate_(currency, cache) {
  if (currency === BASE_CURRENCY) return { rate: 1, source: 'base' };
  if (cache[currency]) return cache[currency];
  const props = PropertiesService.getScriptProperties();
  let rate = 0;
  let source = 'live';
  try {
    const sh = ss_().getSheetByName('Settings');
    sh.getRange(FX_CELLS.pair).setValue(currency + BASE_CURRENCY);
    const rateCell = sh.getRange(FX_CELLS.rate);
    rateCell.setFormula('=IFERROR(GOOGLEFINANCE("CURRENCY:"&' + FX_CELLS.pair + '),"")');
    for (let i = 0; i < 8; i++) {
      SpreadsheetApp.flush();
      const v = rateCell.getValue();
      if (typeof v === 'number' && v > 0) { rate = v; break; }
      Utilities.sleep(750);
    }
  } catch (err) {
    rate = 0;
  }
  if (rate) {
    props.setProperty('FX_' + currency, JSON.stringify({ rate: rate, at: new Date().toISOString() }));
  } else {
    const cached = props.getProperty('FX_' + currency);
    if (cached) { rate = Number(JSON.parse(cached).rate) || 0; source = 'cached'; }
    else source = 'none';
  }
  cache[currency] = { rate: rate, source: source };
  return cache[currency];
}

/** Converts {amount, currency} to PHP. Without any rate, the original amount is kept and flagged. */
function toPhp_(money, fxCache) {
  const fx = getFxRate_(money.currency, fxCache);
  return {
    php: fx.rate ? round2_(money.amount * fx.rate) : round2_(money.amount),
    rate: fx.rate,
    source: fx.source
  };
}

// ════════════════════════════════════════════════════════════════════
//  Sync runner
// ════════════════════════════════════════════════════════════════════
/** Time-driven trigger handler (every 15 min, created from Settings). */
function wiseSyncTrigger() {
  if (getSettings_().wiseSyncEnabled !== 'true') return;
  try {
    runWiseSync_();
  } catch (err) {
    console.error('Wise sync failed: ' + ((err && err.stack) || err));
  }
}

/** API: "Sync now" / "Retry unparsed" from Settings or Review. */
function syncWiseNow_(p) {
  if (p && p.retryUnparsed) {
    withLock_(function () {
      const log = table_('EmailLog');
      const rows = [];
      log.rows.forEach(function (r, i) {
        if (str_(get_(log, r, 'status')) === 'Unparsed' && logSource_(str_(get_(log, r, 'messageId')), str_(get_(log, r, 'source'))) === 'Wise Email') {
          rows.push(i + 2);
        }
      });
      deleteRows_('EmailLog', rows);
    });
  }
  const result = runWiseSync_();
  return { result: result, settings: publicSettings_(), pendingCount: pendingCount_() };
}

function runWiseSync_() {
  const started = Date.now();
  const result = withLock_(function () {
    const settings = getSettings_();
    const query = settings.wiseQuery || DEFAULT_SETTINGS.wiseQuery;
    const wallet = settings.wiseWallet || 'Wise';

    const log = table_('EmailLog');
    const seen = {};
    log.rows.forEach(function (r) {
      const id = str_(get_(log, r, 'messageId'));
      if (id) seen[id] = true;
    });
    const transferNumbers = {};
    readTxns_().forEach(function (x) {
      const m = /Wise #(\d+)/.exec(x.note);
      if (m) transferNumbers[m[1]] = true;
    });

    const newTx = [];
    const newLog = [];
    const fxCache = {};
    const counts = { created: 0, unparsed: 0, skipped: 0 };
    const now = new Date();
    let processed = 0;
    let more = false;
    let start = 0;

    outer:
    while (start < 500) {
      const threads = GmailApp.search(query, start, 50);
      if (!threads.length) break;
      const messages = GmailApp.getMessagesForThreads(threads);
      for (let ti = 0; ti < messages.length; ti++) {
        const threadId = threads[ti].getId();
        for (let mi = 0; mi < messages[ti].length; mi++) {
          const msg = messages[ti][mi];
          const id = msg.getId();
          if (seen[id] || !WISE_PARSER.fromPattern.test(msg.getFrom())) continue;
          if (processed >= WISE_PARSER.maxMessagesPerRun || Date.now() - started > 240000) { more = true; break outer; }
          seen[id] = true;
          processed++;

          const subject = msg.getSubject() || '(no subject)';
          const date = msg.getDate();
          const logRow = function (status, txIds, detail) {
            newLog.push({
              messageId: id, threadId: threadId, emailDate: date, subject: cellText_(subject, 250),
              status: status, transactionId: txIds || '', detail: cellText_(detail, 300), loggedAt: now, source: 'Wise Email'
            });
          };

          let res;
          try {
            res = parseWiseEmail_(subject, msg.getPlainBody());
          } catch (err) {
            counts.unparsed++;
            logRow('Unparsed', '', 'Parser error: ' + err.message);
            continue;
          }
          if (res.status === 'ignored') { counts.skipped++; logRow('Skipped', '', res.detail); continue; }
          if (res.status !== 'ok') { counts.unparsed++; logRow('Unparsed', '', res.detail); continue; }
          if (res.transferNumber && transferNumbers[res.transferNumber]) {
            counts.skipped++;
            logRow('Skipped', '', 'Duplicate of Wise #' + res.transferNumber);
            continue;
          }
          if (res.transferNumber) transferNumbers[res.transferNumber] = true;

          const built = buildWiseEntries_(res, subject, date, wallet, fxCache, now);
          built.forEach(function (x) { newTx.push(x); });
          counts.created += built.length;
          logRow('Parsed', built.map(function (x) { return x.id; }).join(','), res.rule + (built.length > 1 ? ' (+fee)' : ''));
        }
      }
      start += threads.length;
      if (threads.length < 50) break;
    }

    // Entries first, log second: if writing entries fails, the emails are retried next run.
    if (newTx.length) appendObjects_('Transactions', newTx.map(txnFields_));
    if (newLog.length) appendObjects_('EmailLog', newLog);

    const message = counts.created + ' new, ' + counts.unparsed + ' unparsed, ' + counts.skipped + ' skipped' +
      (more ? ' (more waiting, next run continues)' : '');
    setSetting_('lastSync', new Date().toISOString());
    setSetting_('lastSyncResult', message);
    return { message: message, created: counts.created, unparsed: counts.unparsed, skipped: counts.skipped, more: more };
  });
  return result;
}

/** Turns one parsed email into 1–2 entries (main + optional Wise fee). */
function buildWiseEntries_(res, subject, date, wallet, fxCache, now) {
  const out = [];
  const conv = toPhp_(res, fxCache);
  const tags = [];
  if (res.counterparty) tags.push((res.type === 'Income' ? 'From ' : 'To ') + res.counterparty);
  if (res.reference) tags.push('Ref ' + res.reference);
  if (res.transferNumber) tags.push('Wise #' + res.transferNumber);
  if (res.currency !== BASE_CURRENCY) {
    if (conv.source === 'none') tags.push('FX rate unavailable: check the PHP amount');
    else tags.push(res.currency + '→PHP @ ' + conv.rate.toFixed(4) + (conv.source === 'cached' ? ' (cached rate)' : ''));
  }
  if (res.type === 'Transfer' && res.sent) tags.push('Sent ' + res.sent.amount + ' ' + res.sent.currency);
  if (!tags.length) tags.push(subject);

  const day = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
  const main = {
    id: Utilities.getUuid(),
    date: day,
    wallet: wallet,
    type: res.type,
    amount: conv.php,
    originalAmount: res.amount,
    originalCurrency: res.currency,
    category: categoryFor_(res.type, res.counterparty),
    toWallet: res.type === 'Transfer' ? WISE_PARSER.transferToWallet : '',
    note: tags.join(' · ').slice(0, 500),
    source: 'Wise Email',
    status: 'Pending',
    createdAt: now,
    updatedAt: now
  };
  out.push(main);

  if (WISE_PARSER.splitFees && res.type === 'Transfer' && res.fee && res.fee.amount > 0) {
    const feeConv = toPhp_(res.fee, fxCache);
    out.push(Object.assign({}, main, {
      id: Utilities.getUuid(),
      type: 'Expense',
      amount: feeConv.php,
      originalAmount: res.fee.amount,
      originalCurrency: res.fee.currency,
      category: WISE_PARSER.defaultCategory.Fee,
      toWallet: '',
      note: 'Wise fee' + (res.transferNumber ? ' · for #' + res.transferNumber : '')
    }));
  }
  return out;
}

/** Run from the editor to test the parser on your latest Wise emails (changes nothing). */
function testWiseParser() {
  const threads = GmailApp.search(getSettings_().wiseQuery || DEFAULT_SETTINGS.wiseQuery, 0, 5);
  GmailApp.getMessagesForThreads(threads).forEach(function (msgs) {
    msgs.forEach(function (m) {
      Logger.log(m.getSubject() + '\n→ ' + JSON.stringify(parseWiseEmail_(m.getSubject(), m.getPlainBody())));
    });
  });
}
