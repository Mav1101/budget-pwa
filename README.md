# Budget

A personal budget app for the Philippines (base currency ₱ PHP). You install it on Android from Chrome, or as an APK. Google Sheets is the database and Google Apps Script is the API. It works offline, reads Wise notification emails from Gmail, and can pick up GCash/Maya/Landbank phone notifications through MacroDroid.

**Setup:** see [SETUP.md](SETUP.md), which ends with a test checklist.

```
 Phone / desktop (PWA on GitHub Pages)            Google (your account)
┌──────────────────────────────────┐   HTTPS    ┌───────────────────────────┐
│ index.html + ES modules          │  POST JSON │ Apps Script web app       │
│  • Google Identity Services      │ ─────────► │  Code.gs    router        │
│  • IndexedDB cache + write queue │ ◄───────── │  Auth.gs    ID-token check│
│  • Service worker (app shell)    │  {ok,data} │  Sheets.gs  data/migration│
└──────────────────────────────────┘            │  WiseSync   Gmail (read)  │
 MacroDroid ── POST {token,text} ─────────────► │  Webhook    notifications │
                                                └────────────┬──────────────┘
                                                             ▼
                                         Google Sheet: Transactions · Wallets ·
                                         Categories · Settings · EmailLog
```

## Features

- **Dashboard:** total balance, card-style wallet balances, this month's income vs spending with a daily chart, top categories, recent entries, and a count of entries waiting for review.
- **Add entry:** Expense / Income / Transfer, a large amount field that accepts sums (`1,200+350`), wallet and category chips, date shortcuts, note, and **Save & add another**. Works with no signal.
- **Transactions:** search, filters (month, wallet, type, category) kept in the URL, grouped by day with daily totals, infinite scroll, edit and delete.
- **Review:** Pending entries from Wise emails and phone notifications. Fix the type, wallet, category or destination inline, then approve, approve all, edit, or discard.
- **Reports:** 3/6/12-month income vs spending with a net line, a category donut (whole range or a single month, spending or income), and wallet balances at the end of each month.
- **Settings:** wallets (starting balance, color, rename, archive), categories (emoji, type, rename, archive), theme, Wise sync with its email log, MacroDroid webhook with its token, CSV export, unsynced-changes list, and sign out.
- **UI:** light and dark themes (automatic, or pick one), sized for phones first (bottom nav plus a raised **+** button) with a sidebar at 900px and up, safe-area insets, 44px touch targets, skeleton loaders, toasts, and reduced motion when the phone asks for it.

## How it stays safe

- The web app is deployed with *Execute as Me, access Anyone*, and **every** request is checked in code:
  - App requests carry a Google **ID token**. `Auth.gs` checks it with Google's `tokeninfo` endpoint and requires `aud` = your Client ID, a Google issuer, a future `exp`, `email_verified`, and `email` = `ALLOWED_EMAIL`. Successful checks are cached for 5 minutes under a SHA-256 of the token.
  - Webhook requests carry `WEBHOOK_TOKEN`, compared in constant time. They're rejected unless the webhook is turned on.
- Secrets exist only in **Script Properties**: `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID` and `WEBHOOK_TOKEN`. `frontend/js/config.js` holds only the public API URL and Client ID.
- Gmail access is **read-only**. Mail is never labelled, modified or deleted.
- Every write runs under `LockService`. Text that starts with `= + - @` is stored as plain text, so it can't run as a formula (in the Sheet and in CSV exports).
- Errors shown in the app are friendly messages. Stack traces stay in the Apps Script logs.

## Offline and sync

- Every add, edit and delete is written to an **IndexedDB queue** first, even when you're online, then sent in batches with `bulkAdd`. The device creates each entry's ID (a UUID), so a retry never logs the same entry twice. The server skips IDs it already has.
- Changes queued for the same entry are merged on the device: add then edit becomes a single add, and add then delete means nothing is sent. The server resolves conflicting edits by `updatedAt` (the latest change wins).
- The dashboard and lists show queued changes immediately, marked with a cloud icon. The top bar shows **"N unsynced"**; tap it to sync now, or to retry or discard anything that failed.
- The last dashboard, transactions, pending list, reports and bootstrap data are cached in IndexedDB for offline viewing.
- The service worker caches only the app shell, fonts and Chart.js (stale-while-revalidate). **It never caches API calls.**

## Data model (Google Sheet)

Columns are matched **by header name** (with aliases), not position. Sheets from the earlier Apps Script version, and columns you add yourself, keep working. `setup()` only adds missing sheets, columns, rows and IDs.

| Sheet | Columns |
|---|---|
| Transactions | ID, Date, Wallet, Type (Income/Expense/Transfer), Amount (always PHP; an existing "Amount (PHP)" header also works), OriginalAmount, OriginalCurrency, Category, ToWallet, Note, Source (Manual/Wise Email/Webhook), Status (Confirmed/Pending), CreatedAt, UpdatedAt |
| Wallets | ID, Name, Color, StartingBalance, Archived, SortOrder, CreatedAt |
| Categories | ID, Name, Icon, Type (Expense/Income/Both), Archived, SortOrder |
| Settings | Key, Value, plus the GOOGLEFINANCE helper at D1:E2 |
| EmailLog | MessageID, ThreadID, EmailDate, Subject, Status (Parsed/Unparsed/Skipped/Discarded), TransactionID, Detail, LoggedAt, Source |

A wallet's balance is its StartingBalance plus Confirmed income, minus Confirmed expenses, with transfers moving money between wallets. Pending entries don't count until approved. Rows you type straight into the sheet get an ID automatically, so you can edit them in the app.

## API

`POST <API_URL>` with a text/plain body `{ "action": "...", "idToken": "...", "payload": { ... } }`. The response is `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "CODE", "message": "..." }`.

| Action | Payload | Returns |
|---|---|---|
| `getBootstrap` | none | wallets (with balances), categories, settings, totalBalance, pendingCount, sheetUrl |
| `getDashboard` | `month?` | totals, category totals, daily spend, recent 8, wallets |
| `listTransactions` | `q, wallet, type, category, month, status, offset, limit` | `items, total, nextOffset, totals` |
| `addTransaction` | entry with a client `id` | `{txn, duplicate?}` (duplicate IDs are ignored) |
| `updateTransaction` / `deleteTransaction` | entry / `{id}` | updated entry / `{deleted}` |
| `bulkAdd` | `items: [{op: add\|update\|delete, id, txn}]` | a result for each item |
| `listPending` · `approvePending` · `discardPending` | none · `{items:[{id, txn?}]}` or `{all:true}` · `{ids}` | |
| `getReports` | `months (1–24), endMonth?` | monthly income/expense/net, categories per month, wallet trend |
| `saveWallet` · `saveCategory` · `saveSettings` | fields (renames update old entries) | refreshed lists / settings |
| `syncWiseNow` · `getEmailLog` · `getWebhookInfo` · `exportCsv` | `retryUnparsed?` · `status?` · none · filters | |
| `webhook` | `token, app, title?, text, time?` (no ID token) | `{status: pending\|unparsed\|duplicate}` |

## Project layout

```
backend/            Apps Script: paste into the Sheet's script editor, or `clasp push`
frontend/           static PWA, published to GitHub Pages by .github/workflows/pages.yml
  js/config.js      API_URL + GOOGLE_CLIENT_ID (public)
  js/app.js         boot, hash router, nav, sync/offline indicators, re-auth banner
  js/auth.js        Google Identity Services, silent token refresh
  js/api.js         fetch wrapper: retries with backoff, refreshes the token once on expiry
  js/offline.js     IndexedDB cache + write queue + bulkAdd sync
  js/store.js       shared state, error routing
  js/ui.js          formatting (₱), toasts, sheets/dialogs, list rows
  js/pages/*.js     signin, dashboard, add (add/edit), transactions, review, reports, settings
```

The app uses plain HTML, CSS and JavaScript modules with no build step. Chart.js comes from cdnjs and the fonts from Google Fonts (Fraunces for numbers and headings, Plus Jakarta Sans for everything else).

**Hosting path:** `manifest.json` uses a relative `start_url` and `scope` (`./`), and the service worker registers relative to the page. The app therefore works at `https://<user>.github.io/<any-repo-name>/`, at a domain root, or on `localhost`, with nothing to configure.

## Changes from the earlier Apps Script-only version

- Same Sheet and same data. `setup()` adds the new `EmailLog.Source` column and any missing IDs, statuses or settings.
- The Wise parser rules (`WISE_PARSER`) and the webhook rules (`WEBHOOK_PARSER`) carry over, with the same `{MONEY}` / `{PARTY}` / `{END}` tokens. New: the category you approve for a sender is reused next time.
- The separate `webhook-standalone` project is no longer needed; the webhook now lives in this backend.
- The Wise **CSV statement import** (`WiseCsv.gs`) isn't part of this version. The old file is still in `budget-app/` if you want it back.
