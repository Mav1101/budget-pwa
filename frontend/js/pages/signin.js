import * as auth from '../auth.js';
import { esc, icon } from '../ui.js';
import { isDark } from '../theme.js';

export default {
  async mount(el, ctx) {
    const denied = ctx.query.denied === '1';
    el.innerHTML = `
      <div class="page signin-page">
        <div class="signin-card">
          <div class="brand-mark big" aria-hidden="true">₱</div>
          <p class="eyebrow">Personal budget</p>
          <h1 class="display">Every peso,<br><em>accounted for.</em></h1>
          <p class="muted">GCash, Maya, Wise and Landbank in one place. Your data stays in your own Google Sheet.</p>
          ${denied ? `<div class="notice notice-danger">${icon('alert')}<span>That Google account isn't allowed. Sign in with the account set as <b>ALLOWED_EMAIL</b>.</span></div>` : ''}
          <div class="gsi-slot" id="gsi-btn"><div class="skel skel-pill"></div></div>
          <p class="fine">${icon('lock')} Only the owner's Google account can open this app.</p>
        </div>
        <ul class="signin-feats" aria-label="Features">
          <li>${icon('cloud-off')}<span>Works offline</span></li>
          <li>${icon('mail')}<span>Wise email sync</span></li>
          <li>${icon('chart')}<span>Monthly reports</span></li>
        </ul>
      </div>`;

    const slot = el.querySelector('#gsi-btn');
    if (!navigator.onLine) {
      slot.innerHTML = `<div class="notice">${icon('cloud-off')}<span>Connect to the internet to sign in.</span></div>`;
      const retry = () => ctx.go('/signin');
      window.addEventListener('online', retry, { once: true });
      return () => window.removeEventListener('online', retry);
    }
    try {
      await auth.renderButton(slot, { dark: isDark() });
      if (!denied) auth.promptOneTap();
    } catch {
      slot.innerHTML = `<div class="notice notice-danger">${icon('alert')}<span>${esc("Google sign-in couldn't load.")}</span></div>
        <button type="button" class="btn btn-ghost" id="retry">Try again</button>`;
      slot.querySelector('#retry').addEventListener('click', () => location.reload());
    }
    ctx.on('theme', ({ dark }) => auth.renderButton(slot, { dark }).catch(() => {}));
  },
};
