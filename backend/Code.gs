/**
 * Budget API — router.
 *
 * Deployed as a web app (Execute as: Me, Who has access: Anyone). Google does no
 * access control for us, so every request is checked here:
 *   - normal actions need a Google ID token for ALLOWED_EMAIL (Auth.gs)
 *   - the "webhook" action needs WEBHOOK_TOKEN instead (Webhook.gs)
 *
 * Request  (POST, body is JSON sent as text/plain): { action, idToken, payload }
 * Response (JSON): { ok: true, data } | { ok: false, error: CODE, message }
 *
 * Functions ending in "_" are private: they can't be run from the editor's
 * dropdown or called by google.script.run.
 */

const APP_NAME = 'Budget';
const TZ = 'Asia/Manila';
const BASE_CURRENCY = 'PHP';
const API_VERSION = '2.0.0';

function getActions_() {
  return {
    getBootstrap: getBootstrap_,
    getDashboard: getDashboard_,
    listTransactions: listTransactions_,
    addTransaction: addTransaction_,
    updateTransaction: updateTransaction_,
    deleteTransaction: deleteTransaction_,
    bulkAdd: bulkAdd_,
    listPending: listPending_,
    approvePending: approvePending_,
    discardPending: discardPending_,
    getReports: getReports_,
    saveWallet: saveWallet_,
    saveCategory: saveCategory_,
    saveSettings: saveSettings_,
    getWebhookInfo: getWebhookInfo_,
    syncWiseNow: syncWiseNow_,
    getEmailLog: getEmailLog_,
    exportCsv: exportCsv_
  };
}

/** Health check. Reveals nothing about the data. */
function doGet() {
  return json_({ ok: true, data: { service: 'budget-api', version: API_VERSION } });
}

function doPost(e) {
  const req = parseRequest_(e);
  if (!req || typeof req.action !== 'string') {
    return json_({ ok: false, error: 'BAD_REQUEST', message: 'Malformed request.' });
  }

  if (req.action === 'webhook') return json_(handleWebhook_(req));

  const auth = verifyIdToken_(req.idToken);
  if (!auth.ok) return json_({ ok: false, error: auth.error, message: authMessage_(auth.error) });

  const handler = getActions_()[req.action];
  if (!handler) return json_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Unknown action.' });

  try {
    const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    return json_({ ok: true, data: handler(payload, auth) });
  } catch (err) {
    if (err && err.appCode) return json_({ ok: false, error: err.appCode, message: err.message });
    console.error('Action ' + req.action + ' failed: ' + ((err && err.stack) || err));
    return json_({ ok: false, error: 'SERVER_ERROR', message: 'Something went wrong on the server.' });
  }
}

/** Accepts a JSON body (the app, MacroDroid JSON) or form fields (MacroDroid form body). */
function parseRequest_(e) {
  if (!e) return null;
  const body = e.postData && e.postData.contents;
  if (body) {
    try {
      const obj = JSON.parse(body);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch (err) { /* not JSON: fall through to form fields */ }
  }
  if (e.parameter && e.parameter.action) return e.parameter;
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** An error whose code and message are safe to show in the app. */
function appError_(code, message) {
  const err = new Error(message);
  err.appCode = code;
  return err;
}

let LOCK_DEPTH_ = 0;

/** Runs fn while holding the script lock. Nested calls reuse the outer lock. */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw appError_('BUSY', 'The sheet is busy. Please try again in a moment.');
  LOCK_DEPTH_++;
  try {
    const out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
    invalidate_();
  }
}
