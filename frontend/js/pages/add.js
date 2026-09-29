// Add / edit entry. Every save goes through the offline queue, so it works with no signal.
import { api } from '../api.js';
import { enqueue } from '../offline.js';
import { state, wallets, categories, knownTxn, takeHandoff, setPendingCount, handleError } from '../store.js';
import { esc, icon, money, todayStr, addDays, uuid, toast, confirmDialog, round2, friendlyError } from '../ui.js';

const LAST_KEY = 'budget.last';
const TYPES = ['Expense', 'Income', 'Transfer'];

function readLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function writeLast(v) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** "1,200 + 350.50 - 50" → 1500.5 ; NaN when invalid. */
export function evalAmount(raw) {
  const s = String(raw || '').replace(/[₱,\s]/g, '').replace(/[−–]/g, '-');
  if (!s) return NaN;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[+-](?:\d+\.?\d*|\.\d+))*$/.test(s)) return NaN;
  const parts = s.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g) || [];
  return round2(parts.reduce((sum, p) => sum + Number(p), 0));
}

export default {
  async mount(el, ctx) {
    const editId = ctx.params.id ? decodeURIComponent(ctx.params.id) : null;
    const pendingMode = ctx.query.pending === '1';
    const hand = takeHandoff();
    const original = editId ? (hand?.txn?.id === editId ? hand.txn : knownTxn(editId)) : null;

    if (editId && !original) {
      el.innerHTML = `<div class="page"><div class="empty"><div class="empty-ic">${icon('search')}</div>
        <h3>Open this entry from the list</h3><p>It isn't loaded on this device yet.</p>
        <a class="btn btn-primary" href="#/transactions">Go to Transactions</a></div></div>`;
      return;
    }

    const last = readLast();
    const activeWallets = wallets();
    const f = {
      type: original?.type || (TYPES.includes(last.type) ? last.type : 'Expense'),
      amount: original ? String(original.amount) : '',
      wallet: original?.wallet || '',
      toWallet: original?.toWallet || '',
      category: original?.category || '',
      date: original?.date || todayStr(),
      note: original?.note || '',
    };
    const defaultWallet = (type) => {
      const pref = last.wallet?.[type];
      if (pref && activeWallets.some((w) => w.name === pref)) return pref;
      return activeWallets[0]?.name || '';
    };
    if (!f.wallet) f.wallet = defaultWallet(f.type);
    if (f.type === 'Transfer' && !f.toWallet) f.toWallet = activeWallets.find((w) => w.name !== f.wallet)?.name || '';

    const title = pendingMode ? 'Review entry' : original ? 'Edit entry' : 'New entry';
    el.innerHTML = `
      <form class="page entry" novalidate>
        <header class="page-head entry-head">
          <button type="button" class="icon-btn" id="back" aria-label="Back">${icon('arrow-left')}</button>
          <h1>${esc(title)}</h1>
          ${original ? `<button type="button" class="icon-btn danger" id="del" aria-label="Delete">${icon('trash')}</button>` : '<span class="icon-btn-spacer"></span>'}
        </header>
        ${pendingMode ? `<div class="notice">${icon('inbox')}<span>From <b>${esc(original.source)}</b>. Check the details, then approve.</span></div>` : ''}
        <div class="seg seg-type" role="radiogroup" aria-label="Type">
          ${TYPES.map((t) => `<button type="button" role="radio" data-type="${t}">${t}</button>`).join('')}
          <span class="seg-ind" aria-hidden="true"></span>
        </div>

        <label class="amount-field">
          <span class="amount-cur" aria-hidden="true">₱</span>
          <input id="amt" name="amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0.00" aria-label="Amount in pesos" value="${esc(f.amount)}">
        </label>
        <div class="amount-hint" id="amt-hint" aria-live="polite"></div>

        <div class="field">
          <div class="field-label" id="w-label">Wallet</div>
          <div class="chips chips-scroll" id="wallets" role="radiogroup" aria-labelledby="w-label"></div>
        </div>
        <div class="field" id="to-field">
          <div class="field-label" id="to-label">To wallet</div>
          <div class="chips chips-scroll" id="towallets" role="radiogroup" aria-labelledby="to-label"></div>
        </div>
        <div class="field" id="cat-field">
          <div class="field-label" id="c-label">Category</div>
          <div class="chips chips-wrap" id="cats" role="radiogroup" aria-labelledby="c-label"></div>
        </div>

        <div class="field-row">
          <div class="field grow">
            <label class="field-label" for="date">Date</label>
            <input type="date" id="date" class="input" value="${esc(f.date)}" max="${esc(addDays(todayStr(), 366))}">
          </div>
          <div class="date-quick">
            <button type="button" class="chip chip-sm" data-d="0">Today</button>
            <button type="button" class="chip chip-sm" data-d="-1">Yesterday</button>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="note">Note</label>
          <input id="note" class="input" maxlength="500" placeholder="What was it for?" autocomplete="off" enterkeyhint="done" value="${esc(f.note)}">
        </div>

        <div class="form-error" id="err" role="alert" hidden></div>

        <div class="entry-actions">
          ${pendingMode
            ? `<button type="button" class="btn btn-ghost" id="save-only">Save</button>
               <button type="submit" class="btn btn-primary btn-lg" id="save">${icon('check')} Save &amp; approve</button>`
            : `${original ? '' : '<button type="button" class="btn btn-ghost" id="save-more">Save &amp; add another</button>'}
               <button type="submit" class="btn btn-primary btn-lg" id="save">${icon('check')} Save</button>`}
        </div>
      </form>`;

    const form = el.querySelector('form');
    const amt = el.querySelector('#amt');
    const hint = el.querySelector('#amt-hint');
    const errBox = el.querySelector('#err');
    let busy = false;

    const back = () => (history.length > 1 ? history.back() : ctx.go(original ? '/transactions' : '/'));
    el.querySelector('#back').addEventListener('click', back);

    function chip(name, selected, extra = '', attrs = '') {
      return `<button type="button" role="radio" class="chip ${selected ? 'on' : ''}" aria-checked="${selected}" ${attrs}>${extra}<span>${esc(name)}</span></button>`;
    }

    function renderWallets() {
      const list = [...activeWallets];
      for (const n of [f.wallet, f.toWallet]) {
        if (n && !list.some((w) => w.name === n)) list.push({ name: n, color: '#7A7366', balance: null });
      }
      const walletChip = (w, sel, key) =>
        chip(w.name, sel, `<i class="dot" style="background:${esc(w.color)}"></i>`, `data-${key}="${esc(w.name)}"`) ;
      el.querySelector('#wallets').innerHTML = list.length
        ? list.map((w) => walletChip(w, w.name === f.wallet, 'wallet')).join('')
        : '<a class="link" href="#/settings">Add a wallet in Settings</a>';
      el.querySelector('#towallets').innerHTML = list
        .filter((w) => w.name !== f.wallet)
        .map((w) => walletChip(w, w.name === f.toWallet, 'to'))
        .join('');
      el.querySelectorAll('[data-wallet]').forEach((b) =>
        b.addEventListener('click', () => {
          f.wallet = b.dataset.wallet;
          if (f.toWallet === f.wallet) f.toWallet = '';
          renderWallets();
        }),
      );
      el.querySelectorAll('[data-to]').forEach((b) =>
        b.addEventListener('click', () => {
          f.toWallet = b.dataset.to;
          renderWallets();
        }),
      );
    }

    function renderCats() {
      const list = [...categories(f.type)];
      if (f.category && !list.some((c) => c.name === f.category)) list.push({ name: f.category, icon: '🏷️' });
      el.querySelector('#cats').innerHTML = list.length
        ? list.map((c) => chip(c.name, c.name === f.category, `<span class="emoji">${esc(c.icon || '🏷️')}</span>`, `data-cat="${esc(c.name)}"`)).join('')
        : '<a class="link" href="#/settings">Add categories in Settings</a>';
      el.querySelectorAll('[data-cat]').forEach((b) =>
        b.addEventListener('click', () => {
          f.category = b.dataset.cat;
          renderCats();
        }),
      );
    }

    function renderType() {
      form.dataset.type = f.type;
      el.querySelectorAll('.seg-type [data-type]').forEach((b, i) => {
        const on = b.dataset.type === f.type;
        b.setAttribute('aria-checked', on);
        b.classList.toggle('on', on);
        if (on) el.querySelector('.seg-ind').style.transform = `translateX(${i * 100}%)`;
      });
      el.querySelector('#w-label').textContent = f.type === 'Transfer' ? 'From wallet' : 'Wallet';
      el.querySelector('#to-field').hidden = f.type !== 'Transfer';
      el.querySelector('#cat-field').hidden = f.type === 'Transfer';
      renderWallets();
      renderCats();
    }

    el.querySelectorAll('.seg-type [data-type]').forEach((b) =>
      b.addEventListener('click', () => {
        if (f.type === b.dataset.type) return;
        f.type = b.dataset.type;
        if (!original) f.wallet = defaultWallet(f.type);
        if (f.type === 'Transfer' && (!f.toWallet || f.toWallet === f.wallet)) f.toWallet = activeWallets.find((w) => w.name !== f.wallet)?.name || '';
        if (!categories(f.type).some((c) => c.name === f.category)) f.category = '';
        renderType();
      }),
    );

    // Grow the amount input with its text (browsers without CSS field-sizing).
    const autoSize = CSS.supports?.('field-sizing', 'content')
      ? () => {}
      : () => (amt.style.width = `${Math.max(4.2, amt.value.length * 0.62 + 0.8)}ch`);
    const updateHint = () => {
      autoSize();
      const raw = amt.value.trim();
      const v = evalAmount(raw);
      if (/[+\-]/.test(raw.replace(/^[+-]/, '')) && Number.isFinite(v)) hint.textContent = `= ${money(v)}`;
      else hint.textContent = '';
    };
    amt.addEventListener('input', () => {
      amt.classList.remove('invalid');
      updateHint();
    });
    amt.addEventListener('blur', () => {
      const v = evalAmount(amt.value);
      if (Number.isFinite(v) && v > 0) {
        amt.value = v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        hint.textContent = '';
        autoSize();
      }
    });
    amt.addEventListener('focus', () => {
      const v = evalAmount(amt.value);
      if (Number.isFinite(v)) amt.value = String(v);
      autoSize();
    });

    const dateInput = el.querySelector('#date');
    dateInput.addEventListener('change', () => (f.date = dateInput.value));
    el.querySelectorAll('[data-d]').forEach((b) =>
      b.addEventListener('click', () => {
        f.date = addDays(todayStr(), Number(b.dataset.d));
        dateInput.value = f.date;
      }),
    );

    function showError(msg, field) {
      errBox.hidden = false;
      errBox.textContent = msg;
      if (field) {
        field.classList.add('invalid');
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (field.focus) field.focus({ preventScroll: true });
      }
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }

    function collect() {
      errBox.hidden = true;
      el.querySelectorAll('.invalid').forEach((n) => n.classList.remove('invalid'));
      const amount = evalAmount(amt.value);
      if (!Number.isFinite(amount) || amount <= 0) return showError('Enter an amount greater than zero.', amt);
      if (amount > 1e11) return showError('That amount is too large.', amt);
      if (!f.wallet) return showError('Choose a wallet.', el.querySelector('#wallets'));
      if (f.type === 'Transfer') {
        if (!f.toWallet && !(pendingMode && collect.keepPending)) return showError('Choose where the money went.', el.querySelector('#towallets'));
        if (f.toWallet === f.wallet) return showError('From and To must be different wallets.', el.querySelector('#towallets'));
      } else if (!f.category && !(original && !original.category)) {
        return showError('Choose a category.', el.querySelector('#cats'));
      }
      f.date = dateInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return showError('Pick a date.', dateInput);
      const now = new Date().toISOString();
      return {
        id: original?.id || uuid(),
        date: f.date,
        wallet: f.wallet,
        type: f.type,
        amount,
        originalAmount: original && original.originalCurrency && original.originalCurrency !== 'PHP' ? original.originalAmount : amount,
        originalCurrency: original && original.originalCurrency && original.originalCurrency !== 'PHP' ? original.originalCurrency : 'PHP',
        category: f.type === 'Transfer' ? '' : f.category,
        toWallet: f.type === 'Transfer' ? f.toWallet : '',
        note: el.querySelector('#note').value.trim(),
        source: original?.source || 'Manual',
        status: original?.status || 'Confirmed',
        createdAt: original?.createdAt || now,
        updatedAt: now,
      };
    }

    function rememberChoice(txn) {
      const l = readLast();
      l.type = txn.type;
      l.wallet = { ...(l.wallet || {}), [txn.type]: txn.wallet };
      writeLast(l);
    }

    async function save({ another = false, approve = false } = {}) {
      if (busy) return;
      collect.keepPending = pendingMode && !approve;
      const txn = collect();
      if (!txn) return;
      busy = true;
      try {
        if (pendingMode && approve) {
          if (!navigator.onLine) {
            showError('Approving needs a connection. Tap Save to keep your changes for now.');
            return;
          }
          const r = await api('approvePending', { items: [{ id: txn.id, txn }] });
          if (r.failed?.length) {
            showError(r.failed[0].message);
            return;
          }
          setPendingCount(r.pendingCount);
          toast('Approved', { type: 'ok' });
          ctx.go('/review');
          return;
        }
        await enqueue(original ? 'update' : 'add', txn);
        if (!original) rememberChoice(txn);
        const where = state.online ? '' : ' on this device. It will sync when you are online';
        if (another) {
          toast(`Saved ${money(txn.amount)}${where}`, { type: 'ok' });
          amt.value = '';
          el.querySelector('#note').value = '';
          hint.textContent = '';
          amt.focus();
        } else {
          toast(`${original ? 'Updated' : 'Saved'}${where}`, { type: state.online ? 'ok' : 'offline' });
          if (pendingMode) ctx.go('/review');
          else back();
        }
      } catch (err) {
        if (err?.code) {
          handleError(err, { silent: true });
          showError(friendlyError(err));
        } else {
          showError("Couldn't save on this device. Try again.");
        }
      } finally {
        busy = false;
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save({ approve: pendingMode });
    });
    el.querySelector('#save-more')?.addEventListener('click', () => save({ another: true }));
    el.querySelector('#save-only')?.addEventListener('click', () => save());
    el.querySelector('#del')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: pendingMode ? 'Discard this entry?' : 'Delete this entry?',
        message: pendingMode ? "It won't be added to your budget." : 'This removes it from your Sheet.',
        confirmText: pendingMode ? 'Discard' : 'Delete',
        danger: true,
      });
      if (!ok) return;
      if (pendingMode) {
        try {
          const r = await api('discardPending', { ids: [original.id] });
          setPendingCount(r.pendingCount);
          toast('Discarded', { type: 'ok' });
          ctx.go('/review');
        } catch (err) {
          handleError(err);
        }
        return;
      }
      await enqueue('delete', original);
      toast('Deleted', { type: 'ok' });
      back();
    });
    el.querySelector('#note').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save({ approve: pendingMode });
      }
    });

    renderType();
    updateHint();
    if (!original && matchMedia('(pointer: coarse)').matches === false) amt.focus();
    else if (!original) setTimeout(() => amt.focus(), 250);
  },
};
