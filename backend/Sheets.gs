/**
 * Data layer: schema, safe migration, reads/writes and the API actions.
 *
 * Columns are always found by HEADER NAME (with aliases), never by position, so
 * the sheets from the earlier Apps Script-only version and any columns you added
 * yourself keep working. setup() only ADDS missing sheets/columns/rows: it never
 * deletes or reorders anything.
 */

// ════════════════════════════════════════════════════════════════════
//  Schema  —  [key, canonical header, [aliases...]]
// ════════════════════════════════════════════════════════════════════
const SCHEMA_ = {
  Transactions: [
    ['id', 'ID', ['txnid', 'transactionid', 'uuid']],
    ['date', 'Date', ['transactiondate', 'txndate']],
    ['wallet', 'Wallet', ['account', 'fromwallet', 'fromaccount']],
    ['type', 'Type', ['kind', 'transactiontype', 'txntype']],
    ['amount', 'Amount', ['amountphp', 'phpamount', 'value']],
    ['originalAmount', 'OriginalAmount', ['origamount', 'foreignamount', 'amountoriginal']],
    ['originalCurrency', 'OriginalCurrency', ['origcurrency', 'foreigncurrency', 'currency']],
    ['category', 'Category', ['cat']],
    ['toWallet', 'ToWallet', ['toaccount', 'destination', 'destinationwallet']],
    ['note', 'Note', ['notes', 'description', 'memo', 'remarks', 'details']],
    ['source', 'Source', ['origin']],
    ['status', 'Status', ['state']],
    ['createdAt', 'CreatedAt', ['created', 'timestamp', 'dateadded']],
    ['updatedAt', 'UpdatedAt', ['updated', 'modified', 'lastmodified', 'lastupdated']]
  ],
  Wallets: [
    ['id', 'ID', ['walletid']],
    ['name', 'Name', ['wallet', 'walletname', 'account']],
    ['color', 'Color', ['colour']],
    ['startingBalance', 'StartingBalance', ['openingbalance', 'initialbalance', 'opening', 'startbalance']],
    ['archived', 'Archived', ['hidden', 'inactive', 'isarchived']],
    ['order', 'SortOrder', ['order', 'sort', 'position']],
    ['createdAt', 'CreatedAt', ['created']]
  ],
  Categories: [
    ['id', 'ID', ['categoryid']],
    ['name', 'Name', ['category', 'categoryname']],
    ['icon', 'Icon', ['emoji']],
    ['type', 'Type', ['kind']],
    ['archived', 'Archived', ['hidden', 'inactive', 'isarchived']],
    ['order', 'SortOrder', ['order', 'sort', 'position']]
  ],
  Settings: [
    ['key', 'Key', ['setting', 'name']],
    ['value', 'Value', []]
  ],
  EmailLog: [
    ['messageId', 'MessageID', ['id', 'gmailid']],
    ['threadId', 'ThreadID', []],
    ['emailDate', 'EmailDate', ['receivedat', 'date', 'received']],
    ['subject', 'Subject', ['title']],
    ['status', 'Status', []],
    ['transactionId', 'TransactionID', ['transactionids', 'txnid', 'txnids']],
    ['detail', 'Detail', ['snippet', 'error']],
    ['loggedAt', 'LoggedAt', ['logged']],
    ['source', 'Source', ['origin']]
  ]
};

const TX_TYPES = ['Income', 'Expense', 'Transfer'];
const TX_STATUS = ['Confirmed', 'Pending'];
const CAT_TYPES = ['Expense', 'Income', 'Both'];
const SOURCES = ['Manual', 'Wise Email', 'Webhook'];

// Settings are Key/Value rows on the Settings sheet (values stored as text).
const DEFAULT_SETTINGS = {
  theme: 'auto',
  wiseSyncEnabled: 'false',
  wiseQuery: 'from:wise.com newer_than:30d',
  wiseWallet: 'Wise',
  lastSync: '',
  lastSyncResult: '',
  webhookEnabled: 'false'
};

// GOOGLEFINANCE helper cells on the Settings sheet (same cells as the earlier version).
const FX_CELLS = { pairLabel: 'D1', rateLabel: 'E1', pair: 'D2', rate: 'E2' };

const DEFAULT_WALLETS = [
  { name: 'GCash', color: '#0A6CFF' },
  { name: 'Maya', color: '#00A86B' },
  { name: 'Wise', color: '#9FE870' },
  { name: 'Landbank', color: '#C9A227' }
];

const DEFAULT_CATEGORIES = [
  ['Food & Dining', '🍜', 'Expense'],
  ['Groceries', '🛒', 'Expense'],
  ['Transport', '🚌', 'Expense'],
  ['Rent & Housing', '🏠', 'Expense'],
  ['Bills & Utilities', '💡', 'Expense'],
  ['Load & Internet', '📱', 'Expense'],
  ['Shopping', '🛍️', 'Expense'],
  ['Health', '💊', 'Expense'],
  ['Entertainment', '🎬', 'Expense'],
  ['Education', '📚', 'Expense'],
  ['Travel', '✈️', 'Expense'],
  ['Family & Gifts', '🎁', 'Expense'],
  ['Fees & Charges', '💸', 'Expense'],
  ['Other Expense', '📦', 'Expense'],
  ['Salary', '💼', 'Income'],
  ['Freelance', '🧑‍💻', 'Income'],
  ['Interest', '📈', 'Income'],
  ['Gifts Received', '🎉', 'Income'],
  ['Other Income', '💰', 'Income']
];

const WALLET_PALETTE_ = ['#E4572E', '#4F5BD5', '#17A398', '#B14AED', '#EF476F', '#3A86FF', '#FB8500', '#2A9D8F', '#8D6E63'];

// ════════════════════════════════════════════════════════════════════
//  Table access (memoised per request)
// ════════════════════════════════════════════════════════════════════
let TABLE_CACHE_ = {};
let MEMO_ = {};

function invalidate_() {
  TABLE_CACHE_ = {};
  MEMO_ = {};
}

function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw appError_('SERVER_NOT_CONFIGURED', 'This script must be opened from its Google Sheet (Extensions → Apps Script).');
  return ss;
}

function normKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Maps field keys to 0-based column indexes. Exact header matches win over aliases. */
function mapHeaders_(fields, headers) {
  const norm = headers.map(normKey_);
  const map = {};
  const used = {};
  fields.forEach(function (f) {
    const i = norm.indexOf(normKey_(f[1]));
    if (i >= 0 && !used[i]) { map[f[0]] = i; used[i] = true; }
  });
  fields.forEach(function (f) {
    if (map[f[0]] != null) return;
    for (let a = 0; a < f[2].length; a++) {
      const key = normKey_(f[2][a]);
      for (let i = 0; i < norm.length; i++) {
        if (!used[i] && norm[i] === key) { map[f[0]] = i; used[i] = true; return; }
      }
    }
  });
  return map;
}

function table_(name) {
  if (TABLE_CACHE_[name]) return TABLE_CACHE_[name];
  const sh = ss_().getSheetByName(name);
  if (!sh) throw appError_('SERVER_NOT_CONFIGURED', 'The "' + name + '" sheet is missing. Run setup() in Apps Script.');
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const headers = values[0] || [];
  const t = {
    name: name,
    sheet: sh,
    headers: headers,
    map: mapHeaders_(SCHEMA_[name], headers),
    width: Math.max(lastCol, 1),
    rows: values.slice(1)
  };
  TABLE_CACHE_[name] = t;
  return t;
}

function get_(t, row, key) {
  const i = t.map[key];
  return i == null || i >= row.length ? '' : row[i];
}

function str_(v) {
  if (v instanceof Date) return isoDateTime_(v);
  return String(v == null ? '' : v).trim();
}

/** Appends objects ({fieldKey: value}) as new rows. Unknown columns stay blank. */
function appendObjects_(name, objs) {
  if (!objs.length) return;
  const t = table_(name);
  const rows = objs.map(function (o) {
    const row = new Array(t.width).fill('');
    Object.keys(o).forEach(function (k) {
      if (t.map[k] != null) row[t.map[k]] = o[k];
    });
    return row;
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.width).setValues(rows);
  invalidate_();
}

/** Updates some fields of one row. Formulas in other cells of the row are preserved. */
function writeFields_(name, rowNum, fields) {
  const t = table_(name);
  const range = t.sheet.getRange(rowNum, 1, 1, t.width);
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];
  const row = values.map(function (v, i) { return formulas[i] ? formulas[i] : v; });
  Object.keys(fields).forEach(function (k) {
    if (t.map[k] != null) row[t.map[k]] = fields[k];
  });
  range.setValues([row]);
  invalidate_();
}

/** Deletes sheet rows (any order). Keeps at least one non-frozen row, which Sheets requires. */
function deleteRows_(name, rowNums) {
  const sh = table_(name).sheet;
  const rows = rowNums.filter(function (r, i, arr) { return r > 1 && arr.indexOf(r) === i; })
    .sort(function (a, b) { return b - a; });
  if (!rows.length) return;
  if (sh.getMaxRows() - rows.length <= sh.getFrozenRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length);
  rows.forEach(function (r) { sh.deleteRow(r); });
  invalidate_();
}

/** Replaces exact matches in one column (used when a wallet/category is renamed). */
function renameInColumn_(name, key, oldValue, newValue) {
  const t = table_(name);
  const col = t.map[key];
  if (col == null || !t.rows.length || oldValue === newValue) return 0;
  const range = t.sheet.getRange(2, col + 1, t.rows.length, 1);
  const values = range.getValues();
  let changed = 0;
  values.forEach(function (r) {
    if (String(r[0]).trim() === oldValue) { r[0] = cellText_(newValue); changed++; }
  });
  if (changed) range.setValues(values);
  invalidate_();
  return changed;
}

// ════════════════════════════════════════════════════════════════════
//  Value helpers
// ════════════════════════════════════════════════════════════════════
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '' : v).replace(/[₱,\s]|PHP/gi, ''));
  return isFinite(n) ? n : 0;
}
function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function bool_(v) { return v === true || /^(true|yes|y|1)$/i.test(String(v).trim()); }

function isoDate_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY (Sheets default for text dates)
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  const d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Any date-ish cell -> ISO 8601 UTC string ('' if blank). */
function isoDateTime_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString();
}

/** "2026-09-29" -> Date at midnight Asia/Manila. */
function dateFromIso_(s) {
  return Utilities.parseDate(String(s), TZ, 'yyyy-MM-dd');
}

function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function currentMonth_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM'); }

function addMonths_(ym, n) {
  const p = ym.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + n, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function monthsEnding_(endYm, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths_(endYm, -i));
  return out;
}

function validMonth_(v) {
  return /^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : '';
}

/** Parses a client timestamp; clamps anything in the future to now. */
function clientTime_(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  const now = new Date();
  return d > now ? now : d;
}

/** Stops text like "=HYPERLINK(...)" from being treated as a formula. */
function cellText_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (max) s = s.slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cleanName_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function validColor_(v, fallback) {
  const s = String(v || '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : (fallback || '#7A7366');
}

// ════════════════════════════════════════════════════════════════════
//  Readers
// ════════════════════════════════════════════════════════════════════
function readWallets_() {
  if (MEMO_.wallets) return MEMO_.wallets;
  const t = table_('Wallets');
  const list = [];
  t.rows.forEach(function (r, i) {
    const name = str_(get_(t, r, 'name'));
    if (!name) return;
    const known = DEFAULT_WALLETS.filter(function (w) { return w.name.toLowerCase() === name.toLowerCase(); })[0];
    const orderV = get_(t, r, 'order');
    list.push({
      id: str_(get_(t, r, 'id')),
      name: name,
      color: validColor_(get_(t, r, 'color'), known ? known.color : WALLET_PALETTE_[i % WALLET_PALETTE_.length]),
      startingBalance: round2_(num_(get_(t, r, 'startingBalance'))),
      archived: bool_(get_(t, r, 'archived')),
      order: orderV === '' ? i : num_(orderV),
      _row: i + 2
    });
  });
  list.sort(function (a, b) { return a.order - b.order; });
  MEMO_.wallets = list;
  return list;
}

function readCategories_() {
  if (MEMO_.categories) return MEMO_.categories;
  const t = table_('Categories');
  const list = [];
  t.rows.forEach(function (r, i) {
    const name = str_(get_(t, r, 'name'));
    if (!name) return;
    const type = str_(get_(t, r, 'type'));
    const typeNorm = CAT_TYPES.filter(function (c) { return c.toLowerCase() === type.toLowerCase(); })[0];
    const orderV = get_(t, r, 'order');
    list.push({
      id: str_(get_(t, r, 'id')),
      name: name,
      icon: str_(get_(t, r, 'icon')) || '🏷️',
      type: typeNorm || 'Both',
      archived: bool_(get_(t, r, 'archived')),
      order: orderV === '' ? i : num_(orderV),
      _row: i + 2
    });
  });
  list.sort(function (a, b) { return a.order - b.order; });
  MEMO_.categories = list;
  return list;
}

function normType_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^inc/.test(s) || s === 'in' || s === 'credit') return 'Income';
  if (/^tra/.test(s)) return 'Transfer';
  return 'Expense';
}

function rowToTxn_(t, r) {
  const amountCell = get_(t, r, 'amount');
  const amount = round2_(Math.abs(num_(amountCell)));
  const oa = get_(t, r, 'originalAmount');
  const status = str_(get_(t, r, 'status'));
  return {
    id: str_(get_(t, r, 'id')),
    date: isoDate_(get_(t, r, 'date')),
    wallet: str_(get_(t, r, 'wallet')),
    type: normType_(get_(t, r, 'type')),
    amount: amount,
    originalAmount: oa === '' ? amount : round2_(Math.abs(num_(oa))),
    originalCurrency: (str_(get_(t, r, 'originalCurrency')) || BASE_CURRENCY).toUpperCase(),
    category: str_(get_(t, r, 'category')),
    toWallet: str_(get_(t, r, 'toWallet')),
    note: String(get_(t, r, 'note') == null ? '' : get_(t, r, 'note')),
    source: str_(get_(t, r, 'source')) || 'Manual',
    status: /^pend/i.test(status) ? 'Pending' : 'Confirmed',
    createdAt: isoDateTime_(get_(t, r, 'createdAt')),
    updatedAt: isoDateTime_(get_(t, r, 'updatedAt'))
  };
}

/** All transactions with a date and amount. Rows typed by hand get an ID automatically. */
function readTxns_() {
  if (MEMO_.txns) return MEMO_.txns;
  const t = table_('Transactions');
  const out = [];
  const missing = [];
  t.rows.forEach(function (r, i) {
    if (get_(t, r, 'date') === '' || get_(t, r, 'amount') === '') return;
    const x = rowToTxn_(t, r);
    if (!x.date) return;
    x._row = i + 2;
    if (!x.id) missing.push({ txn: x, index: i });
    out.push(x);
  });
  if (missing.length && t.map.id != null) {
    withLock_(function () {
      missing.forEach(function (m) {
        m.txn.id = Utilities.getUuid();
        t.rows[m.index][t.map.id] = m.txn.id;
      });
      const col = t.map.id;
      t.sheet.getRange(2, col + 1, t.rows.length, 1)
        .setValues(t.rows.map(function (r) { return [r[col] === undefined ? '' : r[col]]; }));
    });
  }
  MEMO_.txns = out;
  return out;
}

function publicTxn_(x) {
  const o = {};
  Object.keys(x).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = x[k]; });
  return o;
}

function sortTxnsDesc_(list) {
  return list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return (b._row || 0) - (a._row || 0);
  });
}

function txnIndex_() {
  const idx = {};
  readTxns_().forEach(function (x) { if (x.id) idx[x.id] = x; });
  return idx;
}

function getSettings_() {
  if (MEMO_.settings) return MEMO_.settings;
  const t = table_('Settings');
  const s = Object.assign({}, DEFAULT_SETTINGS);
  t.rows.forEach(function (r) {
    const k = str_(get_(t, r, 'key'));
    if (!k) return;
    const v = get_(t, r, 'value');
    s[k] = v instanceof Date ? v.toISOString() : String(v == null ? '' : v).trim();
  });
  MEMO_.settings = s;
  return s;
}

function setSetting_(key, value) {
  const t = table_('Settings');
  const kc = t.map.key;
  const vc = t.map.value;
  if (kc == null || vc == null) throw appError_('SERVER_NOT_CONFIGURED', 'The Settings sheet needs Key and Value columns. Run setup().');
  const v = cellText_(value == null ? '' : String(value), 500);
  let rowNum = 0;
  let lastKeyRow = 1;
  t.rows.forEach(function (r, i) {
    const k = str_(r[kc]);
    if (k) lastKeyRow = i + 2;
    if (k === key) rowNum = i + 2;
  });
  if (rowNum) {
    t.sheet.getRange(rowNum, vc + 1).setNumberFormat('@').setValue(v);
  } else {
    rowNum = lastKeyRow + 1;
    t.sheet.getRange(rowNum, kc + 1).setValue(key);
    t.sheet.getRange(rowNum, vc + 1).setNumberFormat('@').setValue(v);
  }
  invalidate_();
}

function publicSettings_() {
  const s = getSettings_();
  return {
    theme: s.theme || 'auto',
    wiseSyncEnabled: s.wiseSyncEnabled === 'true',
    wiseTriggerActive: hasTrigger_('wiseSyncTrigger'),
    wiseQuery: s.wiseQuery || DEFAULT_SETTINGS.wiseQuery,
    wiseWallet: s.wiseWallet || 'Wise',
    lastSync: s.lastSync || '',
    lastSyncResult: s.lastSyncResult || '',
    webhookEnabled: s.webhookEnabled === 'true'
  };
}

// ════════════════════════════════════════════════════════════════════
//  Balances
// ════════════════════════════════════════════════════════════════════
function computeBalances_(wallets, txns) {
  const bal = {};
  wallets.forEach(function (w) { bal[w.name] = w.startingBalance || 0; });
  txns.forEach(function (x) {
    if (x.status !== 'Confirmed' || !x.wallet) return;
    if (!(x.wallet in bal)) bal[x.wallet] = 0;
    if (x.type === 'Income') bal[x.wallet] += x.amount;
    else if (x.type === 'Expense') bal[x.wallet] -= x.amount;
    else if (x.type === 'Transfer') {
      bal[x.wallet] -= x.amount;
      if (x.toWallet) {
        if (!(x.toWallet in bal)) bal[x.toWallet] = 0;
        bal[x.toWallet] += x.amount;
      }
    }
  });
  Object.keys(bal).forEach(function (k) { bal[k] = round2_(bal[k]); });
  return bal;
}

/** Wallet list with balances. Wallet names used in entries but missing from the sheet are included. */
function walletsWithBalances_() {
  const wallets = readWallets_();
  const bal = computeBalances_(wallets, readTxns_());
  const out = wallets.map(function (w) {
    return {
      id: w.id, name: w.name, color: w.color, startingBalance: w.startingBalance,
      archived: w.archived, order: w.order, balance: bal[w.name] || 0
    };
  });
  const known = {};
  wallets.forEach(function (w) { known[w.name] = true; });
  Object.keys(bal).forEach(function (name, i) {
    if (known[name]) return;
    out.push({ id: '', name: name, color: '#7A7366', startingBalance: 0, archived: false, order: 1000 + i, balance: bal[name], unlisted: true });
  });
  return out;
}

function totalOf_(wallets) {
  return round2_(wallets.reduce(function (s, w) { return s + w.balance; }, 0));
}

function pendingCount_() {
  return readTxns_().filter(function (x) { return x.status === 'Pending'; }).length;
}

// ════════════════════════════════════════════════════════════════════
//  API actions — read
// ════════════════════════════════════════════════════════════════════
function getBootstrap_(p, auth) {
  const wallets = walletsWithBalances_();
  return {
    user: { email: auth.email },
    wallets: wallets,
    categories: readCategories_().map(publicTxn_),
    settings: publicSettings_(),
    totalBalance: totalOf_(wallets),
    pendingCount: pendingCount_(),
    today: todayIso_(),
    sheetUrl: ss_().getUrl(),
    apiVersion: API_VERSION
  };
}

function getDashboard_(p) {
  const month = validMonth_(p.month) || currentMonth_();
  const prev = addMonths_(month, -1);
  const txns = readTxns_();
  const wallets = walletsWithBalances_();

  let income = 0, expense = 0, prevIncome = 0, prevExpense = 0;
  const catTotals = {};
  const incomeTotals = {};
  const p2 = month.split('-').map(Number);
  const days = new Date(p2[0], p2[1], 0).getDate();
  const daily = new Array(days).fill(0);

  txns.forEach(function (x) {
    if (x.status !== 'Confirmed') return;
    const ym = x.date.slice(0, 7);
    if (ym === month) {
      if (x.type === 'Income') {
        income += x.amount;
        incomeTotals[x.category || 'Uncategorized'] = (incomeTotals[x.category || 'Uncategorized'] || 0) + x.amount;
      } else if (x.type === 'Expense') {
        expense += x.amount;
        catTotals[x.category || 'Uncategorized'] = (catTotals[x.category || 'Uncategorized'] || 0) + x.amount;
        const d = Number(x.date.slice(8, 10));
        if (d >= 1 && d <= days) daily[d - 1] += x.amount;
      }
    } else if (ym === prev) {
      if (x.type === 'Income') prevIncome += x.amount;
      else if (x.type === 'Expense') prevExpense += x.amount;
    }
  });
  Object.keys(catTotals).forEach(function (k) { catTotals[k] = round2_(catTotals[k]); });
  Object.keys(incomeTotals).forEach(function (k) { incomeTotals[k] = round2_(incomeTotals[k]); });

  const recent = sortTxnsDesc_(txns.filter(function (x) { return x.status === 'Confirmed'; }).slice())
    .slice(0, 8).map(publicTxn_);

  return {
    month: month,
    today: todayIso_(),
    wallets: wallets,
    totalBalance: totalOf_(wallets),
    income: round2_(income),
    expense: round2_(expense),
    prevIncome: round2_(prevIncome),
    prevExpense: round2_(prevExpense),
    categoryTotals: catTotals,
    incomeTotals: incomeTotals,
    daily: daily.map(round2_),
    recent: recent,
    pendingCount: pendingCount_()
  };
}

function filterTxns_(p) {
  const q = String(p.q || '').trim().toLowerCase().slice(0, 100);
  const wallet = cleanName_(p.wallet);
  const type = TX_TYPES.indexOf(p.type) >= 0 ? p.type : '';
  const category = cleanName_(p.category);
  const month = validMonth_(p.month);
  const status = p.status === 'All' ? '' : (TX_STATUS.indexOf(p.status) >= 0 ? p.status : 'Confirmed');
  return readTxns_().filter(function (x) {
    if (status && x.status !== status) return false;
    if (month && x.date.slice(0, 7) !== month) return false;
    if (type && x.type !== type) return false;
    if (wallet && x.wallet !== wallet && x.toWallet !== wallet) return false;
    if (category && x.category !== category) return false;
    if (q) {
      const hay = (x.note + ' ' + x.category + ' ' + x.wallet + ' ' + x.toWallet + ' ' + x.amount.toFixed(2)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function listTransactions_(p) {
  const limit = Math.max(1, Math.min(100, Number(p.limit) || 40));
  const offset = Math.max(0, Number(p.offset) || 0);
  const all = sortTxnsDesc_(filterTxns_(p).slice());
  let income = 0, expense = 0;
  all.forEach(function (x) {
    if (x.type === 'Income') income += x.amount;
    else if (x.type === 'Expense') expense += x.amount;
  });
  const items = all.slice(offset, offset + limit).map(publicTxn_);
  return {
    items: items,
    total: all.length,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    totals: { income: round2_(income), expense: round2_(expense) }
  };
}

function listPending_() {
  const items = sortTxnsDesc_(readTxns_().filter(function (x) { return x.status === 'Pending'; }).slice());
  return { items: items.slice(0, 500).map(publicTxn_), total: items.length };
}

function getReports_(p) {
  const n = Math.max(1, Math.min(24, Number(p.months) || 6));
  const end = validMonth_(p.endMonth) || currentMonth_();
  const months = monthsEnding_(end, n);
  const first = months[0];
  const pos = {};
  months.forEach(function (m, i) { pos[m] = i; });

  const income = new Array(n).fill(0);
  const expense = new Array(n).fill(0);
  const expenseByCategory = {};
  const incomeByCategory = {};
  months.forEach(function (m) { expenseByCategory[m] = {}; incomeByCategory[m] = {}; });

  const wallets = readWallets_();
  const txns = readTxns_().filter(function (x) { return x.status === 'Confirmed'; })
    .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  txns.forEach(function (x) {
    const i = pos[x.date.slice(0, 7)];
    if (i == null) return;
    const cat = x.category || 'Uncategorized';
    if (x.type === 'Income') {
      income[i] += x.amount;
      incomeByCategory[months[i]][cat] = round2_((incomeByCategory[months[i]][cat] || 0) + x.amount);
    } else if (x.type === 'Expense') {
      expense[i] += x.amount;
      expenseByCategory[months[i]][cat] = round2_((expenseByCategory[months[i]][cat] || 0) + x.amount);
    }
  });

  // Balance of every wallet at the end of each month.
  const bal = {};
  const color = {};
  wallets.forEach(function (w) { bal[w.name] = w.startingBalance || 0; color[w.name] = w.color; });
  const series = {};
  let k = 0;
  const apply = function (x) {
    if (!(x.wallet in bal)) bal[x.wallet] = 0;
    if (x.type === 'Income') bal[x.wallet] += x.amount;
    else if (x.type === 'Expense') bal[x.wallet] -= x.amount;
    else if (x.type === 'Transfer') {
      bal[x.wallet] -= x.amount;
      if (x.toWallet) { if (!(x.toWallet in bal)) bal[x.toWallet] = 0; bal[x.toWallet] += x.amount; }
    }
  };
  while (k < txns.length && txns[k].date.slice(0, 7) < first) apply(txns[k++]);
  months.forEach(function (m, i) {
    while (k < txns.length && txns[k].date.slice(0, 7) <= m) apply(txns[k++]);
    Object.keys(bal).forEach(function (name) {
      if (!series[name]) series[name] = new Array(n).fill(null);
      series[name][i] = round2_(bal[name]);
    });
  });
  const archived = {};
  wallets.forEach(function (w) { if (w.archived) archived[w.name] = true; });
  const walletTrend = Object.keys(series)
    .filter(function (name) {
      return !archived[name] || series[name].some(function (v) { return v; });
    })
    .map(function (name) {
      return { name: name, color: color[name] || '#7A7366', values: series[name].map(function (v) { return v == null ? 0 : v; }) };
    });

  return {
    months: months,
    income: income.map(round2_),
    expense: expense.map(round2_),
    net: income.map(function (v, i) { return round2_(v - expense[i]); }),
    expenseByCategory: expenseByCategory,
    incomeByCategory: incomeByCategory,
    walletTrend: walletTrend
  };
}

// ════════════════════════════════════════════════════════════════════
//  API actions — transactions (write)
// ════════════════════════════════════════════════════════════════════
/**
 * Validates and normalises an entry coming from the app.
 * opts.allowNoDestination: Transfer without ToWallet (Pending entries only)
 * opts.allowNoCategory:    Income/Expense without Category
 */
function cleanTxn_(p, opts) {
  opts = opts || {};
  p = p || {};
  const id = String(p.id || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw appError_('VALIDATION', 'Invalid entry ID.');
  const type = String(p.type || '').trim();
  if (TX_TYPES.indexOf(type) < 0) throw appError_('VALIDATION', 'Choose Income, Expense or Transfer.');
  const date = String(p.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Utilities.formatDate(dateFromIso_(date), TZ, 'yyyy-MM-dd') !== date) throw appError_('VALIDATION', 'Pick a valid date.');
  const amount = round2_(Number(p.amount));
  if (!(amount > 0) || amount > 1e11) throw appError_('VALIDATION', 'Enter an amount greater than zero.');
  const wallet = cleanName_(p.wallet);
  if (!wallet) throw appError_('VALIDATION', 'Choose a wallet.');

  let toWallet = '';
  if (type === 'Transfer') {
    toWallet = cleanName_(p.toWallet);
    if (!toWallet && !opts.allowNoDestination) throw appError_('VALIDATION', 'Choose the wallet the money went to.');
    if (toWallet && toWallet === wallet) throw appError_('VALIDATION', 'From and To wallets must be different.');
  }
  const category = cleanName_(p.category);
  if (type !== 'Transfer' && !category && !opts.allowNoCategory) throw appError_('VALIDATION', 'Choose a category.');

  const oaRaw = p.originalAmount;
  let originalAmount = oaRaw === '' || oaRaw == null || !isFinite(Number(oaRaw)) ? null : round2_(Math.abs(Number(oaRaw)));
  let originalCurrency = String(p.originalCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(originalCurrency)) originalCurrency = '';
  if (!originalCurrency || originalAmount == null || originalCurrency === BASE_CURRENCY) {
    originalAmount = amount;
    originalCurrency = BASE_CURRENCY;
  }

  return {
    id: id,
    date: date,
    wallet: wallet,
    type: type,
    amount: amount,
    originalAmount: originalAmount,
    originalCurrency: originalCurrency,
    category: category,
    toWallet: toWallet,
    note: String(p.note == null ? '' : p.note).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 500)
  };
}

/** Sheet fields for a full entry. */
function txnFields_(x) {
  return {
    id: x.id,
    date: dateFromIso_(x.date),
    wallet: cellText_(x.wallet),
    type: x.type,
    amount: x.amount,
    originalAmount: x.originalAmount,
    originalCurrency: x.originalCurrency,
    category: cellText_(x.category),
    toWallet: cellText_(x.toWallet),
    note: cellText_(x.note, 500),
    source: x.source,
    status: x.status,
    createdAt: x.createdAt instanceof Date ? x.createdAt : new Date(x.createdAt || Date.now()),
    updatedAt: x.updatedAt instanceof Date ? x.updatedAt : new Date(x.updatedAt || Date.now())
  };
}

/** New manual entry from the app (not yet in the sheet). */
function newManualTxn_(p) {
  const x = cleanTxn_(p);
  const now = new Date();
  x.source = 'Manual';
  x.status = 'Confirmed';
  x.createdAt = clientTime_(p.createdAt) || now;
  x.updatedAt = clientTime_(p.updatedAt) || x.createdAt;
  return x;
}

function outTxn_(x) {
  const o = publicTxn_(x);
  o.createdAt = isoDateTime_(x.createdAt);
  o.updatedAt = isoDateTime_(x.updatedAt);
  return o;
}

/** Merges changes into an existing entry and writes it. Returns {txn, stale?}. */
function applyUpdate_(cur, p, opts) {
  opts = opts || {};
  const clientUpdated = clientTime_(p.updatedAt);
  if (opts.lastWriteWins && clientUpdated && cur.updatedAt && clientUpdated.getTime() <= new Date(cur.updatedAt).getTime()) {
    return { txn: publicTxn_(cur), stale: true };
  }
  let status = TX_STATUS.indexOf(p.status) >= 0 ? p.status : cur.status;
  if (opts.forceStatus) status = opts.forceStatus;
  const merged = cleanTxn_(Object.assign({}, cur, p, { id: cur.id }), {
    allowNoDestination: status === 'Pending',
    allowNoCategory: status === 'Pending' || !cur.category || !!opts.allowNoCategory
  });
  merged.source = cur.source;
  merged.status = status;
  merged.createdAt = cur.createdAt ? new Date(cur.createdAt) : new Date();
  merged.updatedAt = clientUpdated || new Date();
  const fields = txnFields_(merged);
  delete fields.id;
  delete fields.createdAt;
  delete fields.source;
  writeFields_('Transactions', cur._row, fields);
  return { txn: outTxn_(merged) };
}

function addTransaction_(p) {
  return withLock_(function () {
    const x = newManualTxn_(p);
    const existing = txnIndex_()[x.id];
    if (existing) return { txn: publicTxn_(existing), duplicate: true };
    appendObjects_('Transactions', [txnFields_(x)]);
    return { txn: outTxn_(x) };
  });
}

function updateTransaction_(p) {
  return withLock_(function () {
    const cur = txnIndex_()[String(p.id || '')];
    if (!cur) throw appError_('NOT_FOUND', 'That entry no longer exists.');
    return applyUpdate_(cur, p);
  });
}

function deleteTransaction_(p) {
  return withLock_(function () {
    const cur = txnIndex_()[String(p.id || '')];
    if (!cur) return { deleted: false };
    deleteRows_('Transactions', [cur._row]);
    return { deleted: true };
  });
}

/**
 * Offline queue sync. payload.items = [{ op: 'add'|'update'|'delete', id, txn }]
 * - add:    new entry; if the ID exists it is a no-op ("duplicate") unless the
 *           queued copy is newer (it was edited offline), then it updates.
 * - update: last write wins by updatedAt.
 * - delete: removing a missing entry is fine.
 */
function bulkAdd_(p) {
  const items = Array.isArray(p.items) ? p.items.slice(0, 200) : [];
  if (!items.length) return { results: [] };
  return withLock_(function () {
    const index = txnIndex_();
    const results = [];
    const appends = [];
    const appendIds = {};
    const updates = [];
    const deleteRows = [];

    items.forEach(function (it) {
      const op = it && it.op;
      const id = String((it && (it.id || (it.txn && it.txn.id))) || '');
      try {
        if (op === 'add') {
          const x = newManualTxn_(it.txn);
          const cur = index[x.id];
          if (cur) {
            updates.push({ cur: cur, txn: it.txn, id: x.id });
          } else if (appendIds[x.id]) {
            results.push({ id: x.id, status: 'duplicate' });
          } else {
            appendIds[x.id] = true;
            appends.push(x);
            results.push({ id: x.id, status: 'ok' });
          }
        } else if (op === 'update') {
          const cur = index[id];
          if (!cur) throw appError_('NOT_FOUND', 'That entry no longer exists.');
          updates.push({ cur: cur, txn: it.txn, id: id });
        } else if (op === 'delete') {
          const cur = index[id];
          if (cur) deleteRows.push(cur._row);
          results.push({ id: id, status: 'ok' });
        } else {
          throw appError_('BAD_REQUEST', 'Unknown operation.');
        }
      } catch (err) {
        results.push({ id: id, status: 'error', error: err.appCode || 'SERVER_ERROR', message: err.appCode ? err.message : 'Could not save this entry.' });
      }
    });

    updates.forEach(function (u) {
      try {
        const r = applyUpdate_(u.cur, u.txn, { lastWriteWins: true });
        results.push({ id: u.id, status: r.stale ? 'duplicate' : 'ok' });
      } catch (err) {
        results.push({ id: u.id, status: 'error', error: err.appCode || 'SERVER_ERROR', message: err.appCode ? err.message : 'Could not save this entry.' });
      }
    });

    if (appends.length) appendObjects_('Transactions', appends.map(txnFields_));

    if (deleteRows.length) deleteRows_('Transactions', deleteRows);
    return { results: results };
  });
}

function approvePending_(p) {
  return withLock_(function () {
    const index = txnIndex_();
    let list;
    if (p.all) {
      list = readTxns_().filter(function (x) { return x.status === 'Pending'; }).map(function (x) { return { id: x.id }; });
    } else if (Array.isArray(p.items)) {
      list = p.items;
    } else {
      list = (Array.isArray(p.ids) ? p.ids : []).map(function (id) { return { id: id }; });
    }
    let approved = 0;
    const failed = [];
    const approvedIds = [];
    list.slice(0, 500).forEach(function (it) {
      const id = String((it && it.id) || '');
      const cur = index[id];
      if (!cur || cur.status !== 'Pending') return;
      try {
        const changes = Object.assign({}, it.txn || {});
        delete changes.updatedAt;
        applyUpdate_(cur, changes, { forceStatus: 'Confirmed', allowNoCategory: true });
        approved++;
        approvedIds.push(id);
      } catch (err) {
        failed.push({ id: id, message: err.appCode ? err.message : 'Could not approve this entry.' });
      }
    });
    return { approved: approved, approvedIds: approvedIds, failed: failed, pendingCount: pendingCount_() };
  });
}

function discardPending_(p) {
  return withLock_(function () {
    const pending = readTxns_().filter(function (x) { return x.status === 'Pending'; });
    const wanted = {};
    if (!p.all) (Array.isArray(p.ids) ? p.ids : []).forEach(function (id) { wanted[String(id)] = true; });
    const targets = pending.filter(function (x) { return p.all || wanted[x.id]; });
    if (!targets.length) return { discarded: 0, pendingCount: pending.length };

    // Mark the matching EmailLog rows as Discarded (the emails stay "seen", so they are not re-imported).
    const ids = {};
    targets.forEach(function (x) { ids[x.id] = true; });
    const log = table_('EmailLog');
    if (log.map.transactionId != null && log.map.status != null) {
      log.rows.forEach(function (r, i) {
        const linked = String(r[log.map.transactionId] || '').split(/[,\s]+/);
        if (linked.some(function (id) { return ids[id]; })) {
          log.sheet.getRange(i + 2, log.map.status + 1).setValue('Discarded');
        }
      });
    }

    deleteRows_('Transactions', targets.map(function (x) { return x._row; }));
    return { discarded: targets.length, pendingCount: pendingCount_() };
  });
}

// ════════════════════════════════════════════════════════════════════
//  API actions — wallets, categories, settings
// ════════════════════════════════════════════════════════════════════
function saveWallet_(p) {
  withLock_(function () {
    const name = cleanName_(p.name);
    if (!name) throw appError_('VALIDATION', 'Give the wallet a name.');
    const wallets = readWallets_();
    let cur = null;
    if (p.id) cur = wallets.filter(function (w) { return w.id && w.id === String(p.id); })[0] || null;
    if (!cur && p.originalName) cur = wallets.filter(function (w) { return w.name === cleanName_(p.originalName); })[0] || null;
    const clash = wallets.filter(function (w) { return w !== cur && w.name.toLowerCase() === name.toLowerCase(); })[0];
    if (clash) throw appError_('CONFLICT', 'You already have a wallet called "' + clash.name + '".');

    const fields = { name: cellText_(name) };
    if ('color' in p) fields.color = validColor_(p.color);
    if ('startingBalance' in p) {
      const sb = Number(p.startingBalance);
      if (!isFinite(sb) || Math.abs(sb) > 1e11) throw appError_('VALIDATION', 'Starting balance must be a number.');
      fields.startingBalance = round2_(sb);
    }
    if ('archived' in p) fields.archived = !!p.archived;
    if ('order' in p && isFinite(Number(p.order))) fields.order = Number(p.order);

    if (cur) {
      if (cur.name !== name) {
        renameInColumn_('Transactions', 'wallet', cur.name, name);
        renameInColumn_('Transactions', 'toWallet', cur.name, name);
        if ((getSettings_().wiseWallet || 'Wise') === cur.name) setSetting_('wiseWallet', name);
      }
      if (!cur.id) fields.id = Utilities.getUuid();
      writeFields_('Wallets', cur._row, fields);
    } else {
      const maxOrder = wallets.reduce(function (m, w) { return Math.max(m, w.order); }, -1);
      appendObjects_('Wallets', [Object.assign({
        id: Utilities.getUuid(), color: WALLET_PALETTE_[wallets.length % WALLET_PALETTE_.length],
        startingBalance: 0, archived: false, order: maxOrder + 1, createdAt: new Date()
      }, fields)]);
    }
  });
  const wallets = walletsWithBalances_();
  return { wallets: wallets, totalBalance: totalOf_(wallets) };
}

function saveCategory_(p) {
  withLock_(function () {
    const name = cleanName_(p.name);
    if (!name) throw appError_('VALIDATION', 'Give the category a name.');
    const cats = readCategories_();
    let cur = null;
    if (p.id) cur = cats.filter(function (c) { return c.id && c.id === String(p.id); })[0] || null;
    if (!cur && p.originalName) cur = cats.filter(function (c) { return c.name === cleanName_(p.originalName); })[0] || null;
    const clash = cats.filter(function (c) { return c !== cur && c.name.toLowerCase() === name.toLowerCase(); })[0];
    if (clash) throw appError_('CONFLICT', 'You already have a category called "' + clash.name + '".');

    const fields = { name: cellText_(name) };
    if ('icon' in p) fields.icon = cellText_(String(p.icon || '').slice(0, 8)) || '🏷️';
    if ('type' in p) {
      if (CAT_TYPES.indexOf(p.type) < 0) throw appError_('VALIDATION', 'Type must be Expense, Income or Both.');
      fields.type = p.type;
    }
    if ('archived' in p) fields.archived = !!p.archived;
    if ('order' in p && isFinite(Number(p.order))) fields.order = Number(p.order);

    if (cur) {
      if (cur.name !== name) renameInColumn_('Transactions', 'category', cur.name, name);
      if (!cur.id) fields.id = Utilities.getUuid();
      writeFields_('Categories', cur._row, fields);
    } else {
      const maxOrder = cats.reduce(function (m, c) { return Math.max(m, c.order); }, -1);
      appendObjects_('Categories', [Object.assign({
        id: Utilities.getUuid(), icon: '🏷️', type: 'Expense', archived: false, order: maxOrder + 1
      }, fields)]);
    }
  });
  return { categories: readCategories_().map(publicTxn_) };
}

function saveSettings_(p) {
  withLock_(function () {
    if ('theme' in p) {
      if (['auto', 'light', 'dark'].indexOf(p.theme) < 0) throw appError_('VALIDATION', 'Unknown theme.');
      setSetting_('theme', p.theme);
    }
    if ('wiseQuery' in p) {
      const q = String(p.wiseQuery || '').trim();
      if (!q || q.length > 300) throw appError_('VALIDATION', 'Enter a Gmail search query (up to 300 characters).');
      setSetting_('wiseQuery', q);
    }
    if ('wiseWallet' in p) {
      const w = cleanName_(p.wiseWallet);
      if (!w) throw appError_('VALIDATION', 'Choose the wallet for Wise entries.');
      setSetting_('wiseWallet', w);
    }
    if ('wiseSyncEnabled' in p) {
      removeTriggers_('wiseSyncTrigger');
      if (p.wiseSyncEnabled) ScriptApp.newTrigger('wiseSyncTrigger').timeBased().everyMinutes(15).create();
      setSetting_('wiseSyncEnabled', p.wiseSyncEnabled ? 'true' : 'false');
    }
    if ('webhookEnabled' in p) {
      setSetting_('webhookEnabled', p.webhookEnabled ? 'true' : 'false');
      if (p.webhookEnabled) ensureWebhookToken_();
    }
    if (p.regenerateWebhookToken) newWebhookToken_();
  });
  return { settings: publicSettings_(), webhook: webhookInfo_() };
}

function getWebhookInfo_() {
  return webhookInfo_();
}

function webhookInfo_() {
  const token = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN') || '';
  return { enabled: getSettings_().webhookEnabled === 'true', hasToken: !!token, token: token };
}

function ensureWebhookToken_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_TOKEN')) return newWebhookToken_();
  return props.getProperty('WEBHOOK_TOKEN');
}

function newWebhookToken_() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('WEBHOOK_TOKEN', token);
  return token;
}

function hasTrigger_(handler) {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
}

function removeTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

// ════════════════════════════════════════════════════════════════════
//  API actions — email log, CSV
// ════════════════════════════════════════════════════════════════════
function logSource_(id, explicit) {
  if (explicit) return explicit;
  if (/^webhook:/.test(id)) return 'Webhook';
  if (/^csv:/.test(id)) return 'Wise CSV';
  return 'Wise Email';
}

function getEmailLog_(p) {
  const limit = Math.max(1, Math.min(300, Number(p.limit) || 100));
  const status = String(p.status || '');
  const t = table_('EmailLog');
  const counts = {};
  const items = [];
  t.rows.forEach(function (r) {
    const id = str_(get_(t, r, 'messageId'));
    if (!id) return;
    const st = str_(get_(t, r, 'status')) || 'Unknown';
    counts[st] = (counts[st] || 0) + 1;
    if (status && st !== status) return;
    items.push({
      messageId: id,
      source: logSource_(id, str_(get_(t, r, 'source'))),
      date: isoDateTime_(get_(t, r, 'emailDate')) || isoDateTime_(get_(t, r, 'loggedAt')),
      subject: String(get_(t, r, 'subject') || ''),
      status: st,
      transactionId: str_(get_(t, r, 'transactionId')),
      detail: String(get_(t, r, 'detail') || ''),
      loggedAt: isoDateTime_(get_(t, r, 'loggedAt'))
    });
  });
  items.sort(function (a, b) {
    const ka = a.loggedAt || a.date, kb = b.loggedAt || b.date;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  return { items: items.slice(0, limit), counts: counts, total: items.length };
}

function csvCell_(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv_(p) {
  const rows = sortTxnsDesc_(filterTxns_(Object.assign({ status: 'All' }, p)).slice());
  const header = ['ID', 'Date', 'Wallet', 'Type', 'Amount (PHP)', 'OriginalAmount', 'OriginalCurrency', 'Category',
    'ToWallet', 'Note', 'Source', 'Status', 'CreatedAt', 'UpdatedAt'];
  const lines = [header.join(',')];
  rows.forEach(function (x) {
    lines.push([x.id, x.date, x.wallet, x.type, x.amount, x.originalAmount, x.originalCurrency, x.category,
      x.toWallet, x.note, x.source, x.status, x.createdAt, x.updatedAt].map(csvCell_).join(','));
  });
  const suffix = validMonth_(p.month) || Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  return { filename: 'budget-' + suffix + '.csv', csv: lines.join('\r\n'), rows: rows.length };
}

// ════════════════════════════════════════════════════════════════════
//  Setup & migration  —  run setup() once from the editor (safe to re-run)
// ════════════════════════════════════════════════════════════════════
function setup() {
  const log = withLock_(function () { return setupSheets_(); });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_TOKEN')) {
    newWebhookToken_();
    log.push('Created WEBHOOK_TOKEN in Script Properties');
  }
  if (!props.getProperty('ALLOWED_EMAIL')) log.push('⚠ Set ALLOWED_EMAIL in Project Settings → Script Properties');
  if (!props.getProperty('GOOGLE_CLIENT_ID')) log.push('⚠ Set GOOGLE_CLIENT_ID in Project Settings → Script Properties');

  // Keep the trigger in line with the saved setting.
  const wantSync = getSettings_().wiseSyncEnabled === 'true';
  if (wantSync && !hasTrigger_('wiseSyncTrigger')) {
    ScriptApp.newTrigger('wiseSyncTrigger').timeBased().everyMinutes(15).create();
    log.push('Re-created the 15-minute Wise sync trigger');
  }
  if (!wantSync && hasTrigger_('wiseSyncTrigger')) {
    removeTriggers_('wiseSyncTrigger');
    log.push('Removed the Wise sync trigger (sync is off in Settings)');
  }

  // Touch Gmail once so authorization covers it.
  try { GmailApp.search('from:wise.com', 0, 1); } catch (err) { log.push('Gmail check failed: ' + err.message); }

  Logger.log(log.join('\n'));
  return log;
}

function setupSheets_() {
  const ss = ss_();
  const log = [];

  Object.keys(SCHEMA_).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    const created = !sh;
    if (!sh) { sh = ss.insertSheet(name); log.push('Created sheet ' + name); }
    const lastCol = sh.getLastColumn();
    const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    // Trailing empty header cells don't count, so new columns go right after the last header.
    let used = headers.length;
    while (used > 0 && String(headers[used - 1]).trim() === '') used--;
    const map = mapHeaders_(SCHEMA_[name], headers);
    const added = [];
    SCHEMA_[name].forEach(function (f) {
      if (map[f[0]] != null) return;
      used++;
      sh.getRange(1, used).setValue(f[1]);
      added.push(f[1]);
    });
    if (added.length) log.push((created ? 'Wrote headers on ' : 'Added columns to ') + name + ': ' + added.join(', '));
    sh.getRange(1, 1, 1, Math.max(used, 1)).setFontWeight('bold');
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  });
  invalidate_();

  // Number formats only on columns we own; existing formats are not touched.
  const tx = table_('Transactions');
  const fmt = function (t, key, pattern) {
    if (t.map[key] == null) return;
    const r = t.sheet.getRange(2, t.map[key] + 1, Math.max(t.sheet.getMaxRows() - 1, 1), 1);
    if (r.getNumberFormat() === 'General' || r.getNumberFormat() === '') r.setNumberFormat(pattern);
  };
  fmt(tx, 'date', 'yyyy-mm-dd');
  fmt(tx, 'amount', '#,##0.00');
  fmt(tx, 'originalAmount', '#,##0.00');
  fmt(tx, 'createdAt', 'yyyy-mm-dd hh:mm:ss');
  fmt(tx, 'updatedAt', 'yyyy-mm-dd hh:mm:ss');
  fmt(table_('Wallets'), 'startingBalance', '#,##0.00');

  // Backfill blanks on existing rows (IDs, Status, Source). Only empty cells are written.
  const fill = function (t, key, hasContent, value) {
    const col = t.map[key];
    if (col == null || !t.rows.length) return 0;
    let changed = 0;
    const vals = t.rows.map(function (r) {
      const v = r[col];
      if ((v === '' || v == null) && hasContent(r)) { changed++; return [typeof value === 'function' ? value() : value]; }
      return [v == null ? '' : v];
    });
    if (changed) t.sheet.getRange(2, col + 1, vals.length, 1).setValues(vals);
    return changed;
  };
  const txHas = function (r) { return get_(tx, r, 'date') !== '' && get_(tx, r, 'amount') !== ''; };
  const n1 = fill(tx, 'id', txHas, function () { return Utilities.getUuid(); });
  const n2 = fill(tx, 'status', txHas, 'Confirmed');
  const n3 = fill(tx, 'source', txHas, 'Manual');
  if (n1 || n2 || n3) log.push('Backfilled Transactions: ' + n1 + ' IDs, ' + n2 + ' statuses, ' + n3 + ' sources');

  ['Wallets', 'Categories'].forEach(function (name) {
    const t = table_(name);
    const n = fill(t, 'id', function (r) { return str_(get_(t, r, 'name')) !== ''; }, function () { return Utilities.getUuid(); });
    if (n) log.push('Backfilled ' + n + ' IDs on ' + name);
  });
  invalidate_();

  // Seed defaults only into empty sheets.
  if (!readWallets_().length) {
    appendObjects_('Wallets', DEFAULT_WALLETS.map(function (w, i) {
      return { id: Utilities.getUuid(), name: w.name, color: w.color, startingBalance: 0, archived: false, order: i, createdAt: new Date() };
    }));
    log.push('Added default wallets: GCash, Maya, Wise, Landbank');
  }
  if (!readCategories_().length) {
    appendObjects_('Categories', DEFAULT_CATEGORIES.map(function (c, i) {
      return { id: Utilities.getUuid(), name: c[0], icon: c[1], type: c[2], archived: false, order: i };
    }));
    log.push('Added default categories');
  } else if (!readCategories_().some(function (c) { return c.name === 'Fees & Charges'; })) {
    const maxOrder = readCategories_().reduce(function (m, c) { return Math.max(m, c.order); }, -1);
    appendObjects_('Categories', [{ id: Utilities.getUuid(), name: 'Fees & Charges', icon: '💸', type: 'Expense', archived: false, order: maxOrder + 1 }]);
    log.push('Added category Fees & Charges (used for Wise fees)');
  }

  // Settings rows + FX helper.
  const st = table_('Settings');
  if (st.map.value != null) st.sheet.getRange(2, st.map.value + 1, Math.max(st.sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  const existing = getSettings_();
  const have = {};
  st.rows.forEach(function (r) { const k = str_(get_(st, r, 'key')); if (k) have[k] = true; });
  const missing = Object.keys(DEFAULT_SETTINGS).filter(function (k) { return !have[k]; });
  missing.forEach(function (k) { setSetting_(k, existing[k]); });
  if (missing.length) log.push('Added settings: ' + missing.join(', '));

  const sh = table_('Settings').sheet;
  if (!String(sh.getRange(FX_CELLS.pairLabel).getValue()).trim()) sh.getRange(FX_CELLS.pairLabel).setValue('FX pair (helper)').setFontWeight('bold');
  if (!String(sh.getRange(FX_CELLS.rateLabel).getValue()).trim()) sh.getRange(FX_CELLS.rateLabel).setValue('FX rate (GOOGLEFINANCE)').setFontWeight('bold');
  if (!String(sh.getRange(FX_CELLS.pair).getValue()).trim()) sh.getRange(FX_CELLS.pair).setValue('USDPHP');
  if (!sh.getRange(FX_CELLS.rate).getFormula()) {
    sh.getRange(FX_CELLS.rate).setFormula('=IFERROR(GOOGLEFINANCE("CURRENCY:"&' + FX_CELLS.pair + '),"")');
    log.push('Added GOOGLEFINANCE helper at Settings!' + FX_CELLS.pair + ':' + FX_CELLS.rate);
  }
  invalidate_();

  if (!log.length) log.push('Everything already set up. No changes.');
  return log;
}
