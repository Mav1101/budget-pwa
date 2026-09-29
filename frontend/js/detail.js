// Entry detail sheet (shared by Dashboard and Transactions).
import { enqueue } from './offline.js';
import { state, setHandoff, categoryMap } from './store.js';
import { sheet, esc, icon, money, dayLabel, toast, confirmDialog, timeAgo } from './ui.js';

export function openTxnDetail(t, { go, onDeleted } = {}) {
  const cat = categoryMap().get(t.category);
  const isT = t.type === 'Transfer';
  const amtCls = t.type === 'Income' ? 'amt-in' : t.type === 'Expense' ? 'amt-out' : 'amt-trf';
  const amt = t.type === 'Income' ? money(t.amount, { sign: true }) : t.type === 'Expense' ? money(-t.amount) : money(t.amount);
  const rows = [
    ['Type', t.type],
    [isT ? 'From' : 'Wallet', t.wallet],
    isT ? ['To', t.toWallet || '—'] : ['Category', `${cat?.icon ? cat.icon + ' ' : ''}${t.category || '—'}`],
    ['Date', dayLabel(t.date)],
    t.originalCurrency && t.originalCurrency !== 'PHP' ? ['Original', `${t.originalAmount} ${t.originalCurrency}`] : null,
    ['Source', t.source || 'Manual'],
    ['Status', t._unsynced ? 'Saved on this device (not synced yet)' : t.status],
    t.updatedAt ? ['Updated', timeAgo(t.updatedAt)] : null,
  ].filter(Boolean);

  const s = sheet({
    title: isT ? 'Transfer' : t.category || t.type,
    className: 'sheet-detail',
    body: `
      <div class="detail-amt ${amtCls}">${esc(amt)}</div>
      ${t.note ? `<p class="detail-note">${esc(t.note)}</p>` : ''}
      <dl class="detail-list">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="sheet-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">${icon('trash')} Delete</button>
        <button type="button" class="btn btn-primary" data-act="edit">${icon('edit')} Edit</button>
      </div>`,
    onOpen(el, api) {
      el.querySelector('[data-act="edit"]').addEventListener('click', () => {
        api.close();
        setHandoff({ txn: t });
        go(`/edit/${encodeURIComponent(t.id)}${t.status === 'Pending' ? '?pending=1' : ''}`);
      });
      el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        api.close();
        const ok = await confirmDialog({
          title: 'Delete this entry?',
          message: `${amt} · ${t.note || t.category || t.type}. This removes it from your Sheet.`,
          confirmText: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await enqueue('delete', { ...t, _unsynced: undefined });
        toast(state.online ? 'Deleted' : 'Deleted on this device. It will sync when you are online.', { type: 'ok' });
        onDeleted?.(t);
      });
    },
  });
  return s.done;
}
