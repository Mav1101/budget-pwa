# Setup

Takes about 30–45 minutes the first time. You need:

- the Google account that will own the data (this is also the only account that can sign in)
- a GitHub account
- Chrome on your Android phone

Throughout this guide, `<username>` is your GitHub username and `<repo>` is the repository name (for example `budget-pwa`).

---

## 1. Backend: Apps Script + Google Sheet

### 1a. Open the Sheet

- **Already using the earlier Apps Script-only version?** Open **that same Sheet**. Your Transactions, Wallets, Categories, Settings and EmailLog data is reused as-is. `setup()` only adds what's missing: it never deletes rows or columns.
- **Starting fresh?** Go to <https://sheets.new> and name the file, for example *Budget*.

Then choose **Extensions → Apps Script**.

### 1b. Put the backend files in the project

**Coming from the earlier version:** the old script files must go, because they define the same function names (`doPost`, `setup`, `WISE_PARSER`…) and Apps Script would refuse to run. Your old code is still in `budget-app/` on your computer, so nothing is lost. In the Apps Script editor, delete these files (⋮ next to each file → **Delete**): `Code`, `Api`, `WiseSync`, `Webhook`, `WiseCsv`, `Index`, `Styles`, `App`. Deleting script files doesn't touch the Sheet's data.

**Option A: paste (no tools needed)**

1. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
2. Back in the editor (**< >**), create one script file per backend file with **+ → Script**, and paste in the contents:

   | File in `backend/` | Name it in Apps Script |
   |---|---|
   | `Code.gs` | `Code` |
   | `Auth.gs` | `Auth` |
   | `Sheets.gs` | `Sheets` |
   | `WiseSync.gs` | `WiseSync` |
   | `Webhook.gs` | `Webhook` |

3. Open `appsscript.json` and replace everything with `backend/appsscript.json`.
4. Press **Ctrl + S**.

**Option B: clasp (command line)**

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

1. Turn on the Apps Script API at <https://script.google.com/home/usersettings>.
2. In the Apps Script editor, open **Project Settings** and copy the **Script ID**.
3. Create `.clasp.json` in the repo root (it's git-ignored) with this content:

   ```json
   { "scriptId": "PASTE_SCRIPT_ID_HERE", "rootDir": "backend" }
   ```

4. Push. `clasp push` replaces all remote files with the ones in `backend/`, which also removes the old version's files.

   ```bash
   clasp push
   ```

### 1c. Script Properties (the only secrets)

**Project Settings → Script Properties → Add script property**:

| Property | Value |
|---|---|
| `ALLOWED_EMAIL` | your Google address, e.g. `you@gmail.com` (the only account allowed in) |
| `GOOGLE_CLIENT_ID` | the OAuth Client ID from step 2 (come back and fill this in) |

`WEBHOOK_TOKEN` is created for you by `setup()`. Don't put these values anywhere else.

### 1d. Run `setup()` and authorize

1. In the editor, pick **`setup`** in the function dropdown and click **Run**.
2. Click **Review permissions** → your account → **Advanced → Go to (project) (unsafe)** → **Allow**. The "unverified" warning appears because this is your own script, not a published app. It asks for:
   - *See, edit… spreadsheets that this application has been installed in* (only this Sheet)
   - *View your email messages* (read-only Gmail, for Wise sync)
   - *Connect to an external service* (to verify Google sign-in tokens with `oauth2.googleapis.com`)
   - *Allow this application to run when you are not present* (the 15-minute sync trigger)
3. The execution log lists what it created or migrated, for example `Added columns to EmailLog: Source`. Warnings starting with ⚠ tell you which Script Properties are still missing.

`setup()` is safe to run again at any time.

### 1e. Deploy as a web app

1. **Deploy → New deployment** → gear → **Web app**.
2. *Description:* `Budget API`.
3. *Execute as:* **Me**.
4. *Who has access:* **Anyone**. This is required so the PWA and MacroDroid can reach it. Every request is still checked in code: a Google ID token for `ALLOWED_EMAIL`, or the webhook token.
5. **Deploy**, then copy the **Web app URL** (ends in `/exec`).

> Coming from the earlier version: its deployment was *Only myself*. Create this **new** deployment rather than editing the old one. You can archive the old deployment and the separate `webhook-standalone` project; this backend replaces both.

---

## 2. Google Cloud: OAuth Client ID (for "Sign in with Google")

1. Go to <https://console.cloud.google.com/> and create a project (for example *Budget*).
2. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - App name *Budget*, your email as the support and developer contact.
   - Audience: **External**. Leave it in **Testing** and add your own Google address under **Test users**.
   - No extra scopes are needed. Sign-in only uses `openid`, `email` and `profile`.
3. **Clients** (or **Credentials → Create credentials → OAuth client ID**) → Application type **Web application**.
4. **Authorized JavaScript origins**, add all three:
   - `https://<username>.github.io`
   - `http://localhost:8080`
   - `http://localhost`

   Origins have no path, so don't add `/budget-pwa`. No redirect URIs are needed.
5. **Create**, then copy the **Client ID** (`…apps.googleusercontent.com`).
6. Paste it into the Apps Script property `GOOGLE_CLIENT_ID` (step 1c).

New origins can take a few minutes to start working.

---

## 3. Fill in `frontend/js/config.js`

```js
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
  GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
};
```

Both values are public identifiers, not secrets, so they're safe to commit.

---

## 4. Test locally

Serve the `frontend` folder on port 8080 with either command:

```bash
python -m http.server 8080 --directory frontend
```

```bash
npx serve frontend -l 8080
```

Open <http://localhost:8080>, sign in, and add an entry. It should appear in the **Transactions** sheet within a second or two.

The service worker caches files. If a change doesn't appear after you edit a file, reload twice, or open DevTools → Application → Service workers → **Update on reload**.

---

## 5. Publish on GitHub Pages

1. Create a **public** repository on GitHub named `<repo>`. There are no secrets in it: tokens live in Script Properties.
2. From the `budget-pwa` folder:

   ```bash
   git init -b main
   ```

   ```bash
   git add .
   ```

   ```bash
   git commit -m "Budget PWA"
   ```

   ```bash
   git remote add origin https://github.com/<username>/<repo>.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions** tab → wait for *Deploy frontend to GitHub Pages* to go green (re-run it if it ran before you changed the Pages source).
5. Your app is live at **`https://<username>.github.io/<repo>/`**.

The manifest uses relative `start_url`/`scope` (`./`), so the app works under any repo name or subpath with nothing to change. Every deploy stamps the service worker with the commit ID, so phones pick up the new version (they show a "new version is ready" toast).

---

## 6. Install on your phone (PWA)

1. Open `https://<username>.github.io/<repo>/` in **Chrome on Android** and sign in.
2. Tap **⋮ → Install app** (or **Add to Home screen → Install**).
3. Open **Budget** from the home screen. It runs full-screen, works offline, and long-pressing the icon gives **Add entry** and **Review** shortcuts.

This is enough for daily use. The APK in step 7 is optional.

---

## 7. Android APK (PWABuilder)

1. Go to <https://www.pwabuilder.com>, enter `https://<username>.github.io/<repo>/`, and click **Start**.
2. **Package for stores → Android → Generate package**. In options:
   - *Package ID:* for example `io.github.<username>.budget`
   - *Signing key:* **Create new** (fill in your name)
3. Download the zip. It contains `*.apk` (to sideload), `*.aab` (Play Store), `signing.keystore`, `signing-key-info.txt` and `assetlinks.json`.
   **Back up the keystore and key info privately.** You need them to ship updates. They're git-ignored, so never commit them.

### Digital Asset Links (removes the browser bar at the top of the app)

Android looks for the file at the **root of the domain**: `https://<username>.github.io/.well-known/assetlinks.json`, not under `/<repo>/`. A project site can't serve the domain root, so pick one:

- **A. User-site repo (recommended):** create a second public repo named exactly **`<username>.github.io`** containing:
  - `.nojekyll` (empty file; without it GitHub Pages hides dot-folders)
  - `.well-known/assetlinks.json` (the file from the PWABuilder zip)

  Enable Pages for it (**Settings → Pages → Deploy from a branch → main / root**).
- **B. This repo at the root:** if this repo *is* `<username>.github.io`, or you point a custom domain at it, replace the placeholder `frontend/.well-known/assetlinks.json` (currently `[]`) with PWABuilder's file and push.

Check it: open `https://<username>.github.io/.well-known/assetlinks.json` in a browser. You should see JSON containing your package ID and SHA-256 fingerprint. Without it the APK still works; it just shows a small Chrome URL bar.

### Sideload

1. Copy the `.apk` to the phone (Google Drive, USB, or email it to yourself).
2. Open it from **Files**. Allow **Install unknown apps** for that app when asked.
3. If Play Protect warns about an unknown developer, choose **Install anyway** (the developer is you).

The APK is a thin Chrome wrapper around the live site, so frontend updates arrive automatically. You only rebuild the APK to change its name, icon or package settings.

---

## 8. Wise email sync and phone notifications

### Wise sync

1. App → **More → Settings → Wise email sync**.
2. Check the **Gmail search**. The default is `from:wise.com newer_than:30d`; tap **Save** if you change it.
3. Tap **Sync now**. The result reads like *"3 new, 0 unparsed, 1 skipped"*.
4. Turn on **Check Gmail every 15 minutes**. This creates a time-driven trigger (visible under **Triggers** ⏰ in Apps Script). Turning it off deletes the trigger.
5. New entries wait in **Review** as *Pending* and don't affect balances until approved.

How your two sample emails are recorded:

| Email | Result |
|---|---|
| "500.80 PHP is now in your account", Amount 540 PHP, Wise fee 39.20 PHP, Transfer #2396103082 | **Transfer** ₱500.80 out of Wise (you choose the destination wallet in Review) **+ Expense** ₱39.20 *Fees & Charges*. Together they equal the ₱540 that left Wise. |
| "You received 10,226.97 PHP from WebForce Digital", Ref 9-21, Transfer #2394169317 | **Income** ₱10,226.97, note *From WebForce Digital · Ref 9-21 · Wise #2394169317* |

- Non-PHP amounts are converted with `GOOGLEFINANCE("CURRENCY:XXXPHP")` using the helper cells at **Settings!D2:E2**. Both the original and PHP amounts are stored.
- The category you approve for a sender is remembered and reused next time (e.g. WebForce Digital → Freelance). You can also hard-code this in `WISE_PARSER.counterpartyCategories`.
- Emails that match no rule are logged as **Unparsed** (Settings → Email log). To tune rules, edit `WISE_PARSER` at the top of `WiseSync.gs`, redeploy (step 9), then tap **Retry unparsed**. To try the parser on your newest emails without saving anything, run `testWiseParser` from the editor.
- Gmail access is read-only: nothing is labelled, archived or deleted.

### MacroDroid (optional, off by default)

1. App → Settings → **Phone notifications** → turn on **Accept notifications** → **Show setup details**. Copy the URL and token.
2. In MacroDroid, create a macro:
   - **Trigger:** *Notification → Notification Received* → select GCash, Maya and your Landbank app.
   - **Action:** *Connectivity → HTTP Request*
     - Method **POST**, URL = your web app URL (`…/exec`)
     - Body: either
       - **Form fields** (recommended, because quotes in notification text can't break it): `action` = `webhook`, `token` = *your token*, `app` = `[not_app_name]`, `title` = `[not_title]`, `text` = `[notification]`
       - or **text/plain JSON**: the "Copy body" text from Settings, with your real token.
3. Pay ₱1 with GCash to test. A Pending entry should appear in Review. Notifications that don't match show in the email log as *Unparsed [GCash] …*. Tune `WEBHOOK_PARSER` in `Webhook.gs` if needed.
4. **Regenerate token** in Settings immediately invalidates the old one (update MacroDroid afterwards).

---

## 9. Updating

**Backend (Apps Script):** paste or `clasp push` the new code, then **Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy**. The `/exec` URL stays the same. Don't use *New deployment* for updates, because that creates a new URL. Run `setup()` again if the release notes mention new columns (it's always safe).

**Frontend:** commit and push to `main`. GitHub Actions redeploys, and open apps show "A new version is ready → Reload".

---

## Troubleshooting

| You see | Fix |
|---|---|
| "Almost there" screen | `API_URL` / `GOOGLE_CLIENT_ID` are empty in `js/config.js`. |
| Google popup: *origin not allowed* / *invalid_client* | Add the exact origin in step 2.4 (scheme + host + port, no path); wait a few minutes. |
| "This Google account is not allowed" | `ALLOWED_EMAIL` doesn't match the account you signed in with. |
| "The backend is not set up yet" | Script Properties missing, or the sheets don't exist: run `setup()`. |
| "The server sent an unexpected reply" | `API_URL` is wrong, ends in `/dev`, or the deployment's access isn't **Anyone**. |
| "The backend is out of date" | You changed the code but didn't publish a **new version** (step 9). |
| "Session paused" banner | Google needs one tap to renew sign-in: tap **Continue**. Unsynced entries are safe on the device. |
| Wise entries in the wrong currency amount | Check `Settings!E2` shows a number; GOOGLEFINANCE occasionally lags. Fix the amount in Review before approving. |

---

## Test checklist

Tick these off after setup (phone unless noted):

**Sign-in**
- [ ] Sign in with `ALLOWED_EMAIL` → Dashboard loads with your wallets.
- [ ] Sign in with a different Google account → "not allowed" message, no data shown.
- [ ] Leave the app open for more than an hour, then use it → it keeps working (silent refresh) or shows the *Continue* banner, never an error.

**Add / edit / delete**
- [ ] Add an Expense with amount `250+49.75` → shows ₱299.75; appears in the Transactions sheet.
- [ ] **Save & add another** keeps wallet/date and clears amount/note.
- [ ] Add an Income and a Transfer (GCash → Maya); both wallet balances change correctly.
- [ ] Edit an entry (change category) → the sheet row updates, `UpdatedAt` changes.
- [ ] Delete an entry → confirm dialog → row removed from the sheet.

**Offline**
- [ ] Airplane mode → the "Offline" chip shows; dashboard and lists still display.
- [ ] Add 2 entries offline → "2 unsynced" chip; balances update immediately.
- [ ] Turn airplane mode off → they sync within seconds; the chip disappears; the sheet has exactly 2 new rows (no duplicates).

**Wise sync & review**
- [ ] Settings → Sync now → result line; new Pending entries appear in Review with a badge.
- [ ] Run Sync now again → "0 new" (no duplicates).
- [ ] Approve all → transfers without a destination wallet stay; the rest are approved.
- [ ] Pick a destination for the Wise transfer → Approve → balances update.
- [ ] Discard one → it disappears and isn't re-imported on the next sync (email log shows *Discarded*).
- [ ] Turn on the 15-minute sync → a trigger appears in Apps Script → Triggers.

**Reports & settings**
- [ ] Reports: 3M/6M/12M switch, category donut per month, wallet balance lines.
- [ ] Add/rename/archive a wallet and a category; renaming updates old entries.
- [ ] Theme Auto/Light/Dark.
- [ ] Export CSV opens/downloads a file that Excel/Sheets reads correctly (₱ and emoji intact).

**Install**
- [ ] Chrome → Install app → opens full-screen from the home-screen icon; long-press shows *Add entry*.
- [ ] Open the installed app offline → it loads.
- [ ] APK installs; with `assetlinks.json` live, no browser bar is shown.
- [ ] (Optional) MacroDroid: a GCash notification creates a Pending entry.
