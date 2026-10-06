# ARAHAS PPE Management System
### Deployment Guide & User Manual — v2 (Vercel + Google Sheets)

---

## v3 update — what changed (read this first)

**No sheet migration is needed.** Deploy the new code over the old; your existing Google Sheet works as-is.

| You asked for | What it does now |
|---|---|
| Role check + auto-assign PPE | Choosing a role when adding an employee looks up that role's active rules and **assigns those PPE items automatically** as a draft kit. A live preview shows the kit *before* you click Add. Changing a pending person's role **replaces** their kit with the new role's standard kit. If a role has no PPE defined, you are told and can add items by hand. |
| Update / delete PPE before approval | Every pending employee card shows their kit: change **quantity**, **Remove** an item, or **add any item from the catalogue** (each shows how much is free in stock). "Reset to role standard" restores the default. Nothing is final until you press **Approve**. |
| Dashboard reflects real stock | Every PPE item shows on-hand total, reserved (approved but not collected), free-to-allocate, and a bar per size. Alerts list shortfalls, out-of-stock and low sizes. The screen **refreshes itself every 60 s** (and when you return to the tab). Tiles: awaiting approval, awaiting collection, stock alerts, issued in 30 days; plus a 14-day issue chart and employee pipeline. |
| Employees hold many PPE | An employee can hold any number of items. **Open** an employee to see everything issued to date, and use **Assign more PPE** (tick several at once) at any time after approval — they queue for the store keeper. |

Also fixed while testing: employee IDs can no longer repeat after a deletion; the password-hash table is no longer sent to the browser; sheet values are typed correctly on read (booleans/numbers); a partly out-of-stock collection now saves and refreshes instead of showing an error; store keepers must choose a size deliberately (no accidental first-size default); the two "Safety Boots" items are now labelled by brand (Safety Joggers / Redwings); new roles can be created just by adding a rule for them (Rules tab).

**Try it without Google:** `npm install`, then `npm run demo` → http://localhost:3000 (login `admin` / `demo` or `store` / `demo`). It runs the real API against an in-memory sheet pre-loaded with the stock counts from the Aug 2026 PPE Register. `npm test` runs 17 automated checks of the business rules.

**Rules of thumb for stock alerts:** a size that has never been counted is treated as "not stocked", not "low". A size raises a Low alert only after it has been counted and falls below its alert level.

---

## 0. What changed from the first build

| Problem you flagged | Fixed by |
|---|---|
| No edit/delete for employees | Directory now has **Edit** and **Delete** buttons per employee (Delete only offered while nothing's been physically collected yet — see §4). |
| No undo | Every collected item has an **Undo** button in the employee's History dialog — it puts the stock back and re-opens the item as pending, with a logged reason. |
| Can't cancel a wrongly-approved item | **Remove** button on any not-yet-collected line in History. |
| No way to clear/correct the database | Inventory tab takes **signed adjustments** (+/-) with a mandatory reason — that *is* your correction/write-off tool, and every change lands in `Stock_Movements` for audit. Entitlement rules now have a **Delete** button too. |
| Deployed via Apps Script Web App | Backend is now a **Vercel serverless function** (`/api/rpc`) talking to Google Sheets through the official Sheets API. No Apps Script deployment, no `doPost`/`doGet` quirks, no "authorize this app" prompts for end users. |

Nothing else about the workflow changed — it still follows `PPE_System_PRD.md` §4 exactly: Admin approves → Store Keeper issues → stock auto-deducts → everything is logged.

---

## 1. Architecture (why it's built this way)

```
Browser (index.html, static)
        │  fetch('/api/rpc', {fn, args})
        ▼
Vercel serverless function (api/rpc.js)
        │  Google Sheets API (service account)
        ▼
Google Sheet  ← Caleb can open this directly, any time, and see everything
```

- **No database to run or pay for.** The Google Sheet *is* the database — one tab per table, exactly matching `PPE_System_PRD.md` §5. Caleb can open it and see real data without touching the app.
- **No server to maintain.** Vercel's free tier runs the API on demand; there's nothing to patch, reboot, or leave running.
- **Cheap to keep alive for years.** Static HTML + one serverless function + a free Google Sheet is about as little surface area as a working system can have — that's deliberate, since this needs to keep running with minimal attention long after this project handover.
- **Clean upgrade path.** Every tab maps 1:1 to a future Postgres table (PRD §8.1). If usage ever outgrows Sheets (many simultaneous store keepers), swap `lib/sheets.js` for a Postgres client — nothing else changes.

---

## 2. One-time setup (do this once, in order)

### 2.1 Create the Google Sheet
1. Create a new Google Sheet. Name it e.g. **ARAHAS PPE — Live Data**.
2. Copy its ID from the URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
3. Leave it empty — the seed script (step 2.4) creates every tab and header for you.

### 2.2 Create a Google Cloud service account
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create (or reuse) a project.
2. Enable the **Google Sheets API** for that project.
3. IAM & Admin → Service Accounts → **Create service account** (any name, e.g. `ppe-system`).
4. Open it → Keys → **Add key → JSON**. Download it — this is the only copy you'll get.
5. Open the Sheet from step 2.1 → **Share** → paste the service account's `...@...gserviceaccount.com` email → give it **Editor** access.

### 2.3 Push the code to GitHub
```bash
cd arahas-ppe-system
git init && git add . && git commit -m "ARAHAS PPE system v2"
git branch -M main
git remote add origin https://github.com/<your-org>/arahas-ppe-system.git
git push -u origin main
```

### 2.4 Seed the sheet (run once, from your own machine)
```bash
npm install
cp .env.example .env        # then fill in the three values from the JSON key + the sheet ID
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # generate SESSION_SECRET, paste into .env

node scripts/setup-sheet.js "caleb" "ChooseAStrongPassword1" "storekeeper1" "ChooseAStrongPassword2"
```
This creates every tab, writes the full 13-item PPE catalogue, seeds sensible default entitlement rules, and creates the two logins above with securely hashed passwords. **Inventory starts at 0 for every size** — load real counts next (§2.6).

### 2.5 Deploy to Vercel (fastest of the two options — live in under a minute)
1. [vercel.com](https://vercel.com) → **Add New Project** → import the GitHub repo.
2. Framework preset: **Other** (it's plain static + serverless, no build step needed).
3. Under **Environment Variables**, add the same three from your `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY` (paste it with the literal `\n` line breaks, exactly as in the JSON key)
   - `SHEET_ID`
   - `SESSION_SECRET`
4. Deploy. You'll get a URL like `arahas-ppe-system.vercel.app` immediately. Every future `git push` to `main` redeploys automatically.
5. (Optional) Add a custom domain under Project → Settings → Domains.

### 2.6 Load real stock counts
Sign in → **Stock count** → upload your current stock register (`Inventory - PPEs.xlsx`) and apply it — see §9. (You can still type `qty_on_hand` straight into the sheet's `Inventory` tab if you prefer.) This is the only manual data entry needed at go-live — everything after this point is entered through the app so it stays audited.

---

## 3. Logging in
Go to your Vercel URL. Sign in with the username/password created in §2.4.
- **Admin** (Caleb): full access — approvals, rules, inventory, replacements, reports.
- **Store Keeper**: collections queue, employee lookup, replacement requests, own activity log.

Sessions last 12 hours (one shift) and are stored as a signed token in the browser — no separate login database to manage. To add more accounts later, insert rows directly into the `Users` tab using bcrypt-hashed passwords (ask a developer to run `scripts/setup-sheet.js`-style hashing, or extend it into a small "add user" script — deliberately not exposed in the UI, since account creation should stay a deliberate, off-app action).

---

## 4. Admin manual (Caleb)

### 4.1 Approve a new employee
**Employees → Add employee** → name + role → **Add employee**. They appear under **Pending approval** with their role's default kit pre-checked (from **Rules**). Untick anything that doesn't apply, then **Approve selected items**. This assigns their permanent Employee ID and moves them into the Store Keeper's queue.

**Added someone by mistake?** While they're still Pending, click **Discard employee** on their card — gone, no trace, nothing to undo.

### 4.2 Fix a mistake after approval
- **Wrong name or role, before anything is collected:** Employees → find them → **Edit**. Role can only be changed while status is still `Pending` (before approval) — once approved, only the name is editable, to protect the audit trail.
- **Approved the wrong item:** Employees → find them → **History** → click **Remove** next to any item still `Pending` (not yet collected). It disappears from their kit with no stock impact.
- **Store keeper issued the wrong item, or issued it by accident:** Employees → find them → **History** → click **Undo** next to the `Collected` line. You'll be asked why — the stock goes straight back into Inventory and the item reopens as pending for a correct re-issue.
- **Employee left / record no longer needed, and nothing has been collected yet:** Employee directory → **Delete**. (Once anything is `Collected` for them, Delete is hidden — that's real stock history and stays; use Undo on the specific item instead if it was wrong.)

### 4.3 Entitlement rules
**Rules** → set which items each role gets by default, and the quantity. Turning a rule inactive (Active = No) stops it being offered to new approvals but keeps it visible for history; **Delete** removes the row outright. Changing a rule never retroactively changes already-approved employees.

### 4.4 Inventory
**Inventory** → pick an item/size → enter a **signed change** (positive for deliveries/found stock, negative for damage/write-offs/corrections) → give a reason → **Save adjustment**. This is also how you correct a miscount — there's no separate "reset" button by design, so every change to stock is a reasoned, logged entry in `Stock_Movements`, visible on the Dashboard.

### 4.5 Replacement requests
**Replacements** → approve or reject what the Store Keeper has flagged. Approving creates a new pending item on that employee's record, ready for the Store Keeper to issue once in stock.

### 4.6 Reports
**Reports** → filter by date/role/item → **Export CSV** for anything you need to hand to management, or **Print** for a paper copy. **Outstanding approvals** on the same screen shows who's approved but hasn't fully collected yet.

---

## 5. Store Keeper manual

### 5.1 Issue PPE
**Collections** shows every employee with something outstanding. Tick the items you're handing over, choose the correct size for each (sizes with insufficient stock are greyed out automatically), then **Confirm selected collection**. Anything you leave unticked, or that's out of stock, stays pending — the employee's status shows `Partially Collected` until everything is collected.

### 5.2 Look up anyone
**Employees** → search by name or ID → **History** shows their full issuance record. If something looks wrong, flag it to Caleb — corrections (Edit/Delete/Undo) are an Admin action so there's always one accountable approver behind any change to history.

### 5.3 Request a replacement
**Replacements → Request replacement** → pick the employee, item, and reason (e.g. "worn out", "annual refresh"). It goes to Caleb's queue; once approved, it appears in your Collections queue like any other pending item.

### 5.4 Your own activity
**My activity** shows only what you personally have issued — a private self-audit log.

---

## 6. Data model reference
See `PPE_System_PRD.md` §5 for the full field-by-field spec, and `ARAHAS_PPE_Master_Data.xlsx` for the same schema as a fillable, human-readable workbook. The live Google Sheet uses identical tab names and columns, so the two always stay comparable.

## 7. Support notes
- **Forgot a password:** re-run the relevant line of `scripts/setup-sheet.js` logic (or ask a developer) to generate a new bcrypt hash and paste it over the old one in the `Users` tab.
- **Sheets API quota:** far below any Google quota at this scale (a few internal users); no action needed.
- **Backups:** Google Sheets keeps automatic version history (File → Version history) — a free, built-in audit/backup trail on top of `Stock_Movements`.

---

## 8. Install as an app, and push notifications (new)

### 8.1 What this gives you
- **Install as an app** — on desktop (Chrome/Edge) and Android, an "Install app" button appears next to the sign-out button; on iPhone/iPad it shows "Add to Home Screen" with instructions (Apple doesn't allow silent installs — the Share → Add to Home Screen step is unavoidable there). Installed, it opens in its own window with the Arahas icon, no browser bar — same idea as installing WhatsApp Web.
- **Push notifications** — once a user taps **Enable notifications** and allows it, their device gets a native notification for:
  - **Store Keeper:** an employee is approved and ready to collect; a replacement request is approved and ready to issue.
  - **Admin (Caleb):** a store keeper raises a replacement request.
  Tapping the notification opens the app straight to the dashboard.

### 8.2 One-time setup (in addition to §2)
1. `npm install` (now also installs `web-push`).
2. `npm run vapid` — prints a public/private keypair. Keep the private key secret.
3. In **Vercel → Project → Settings → Environment Variables**, add:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` = `mailto:you@yourcompany.com` (any contact address — required by the push spec, shown only to push providers, never to users)
4. Open `index.html`, find `PASTE_YOUR_VAPID_PUBLIC_KEY_HERE` near the top of the script, and paste the **public** key there (it's safe to be visible in the frontend — it isn't a secret, it just tells the browser which server is allowed to push to it).
5. Redeploy. The app auto-creates a `Push_Subscriptions` tab in the Sheet the first time someone enables notifications — no manual sheet setup needed.

### 8.3 What if I skip this?
Nothing breaks. Without VAPID keys, the "Enable notifications" button silently doesn't appear, and the server-side push calls are automatically skipped (see `lib/push.js`) — every existing feature works exactly as before.

### 8.4 Notes
- Notifications are **per device/browser**, not per account — a store keeper who signs in on their phone and their desktop needs to enable it on both if they want both to ping.
- iOS requires the app to be **installed to the Home Screen first** (§8.1) before it can ask for notification permission — this is an Apple restriction, not something this app can skip.
- If a device stops responding to pushes (uninstalled, permissions revoked), the server automatically forgets it the next time a push to it fails — no manual cleanup needed.

---

## 9. Stock count — upload a stock sheet or send a counting link (new)

Both Admins and Store Keepers have a **Stock count** tab. There are two ways to bring counts in, and both end at the same **review screen**: you see every line as *now → counted → after* before anything changes. Each line you apply is recorded in Stock movements with who did it, where the figures came from, and any change in defective stock.

### 9.1 Upload a stock sheet
1. **Stock count → Choose an Excel file** (`.xlsx` or `.csv`, up to 5 MB). Old `.xls` files must be re-saved as `.xlsx` first.
2. The app finds the header row and matches every row to a catalogue item and size. It understands the **PPE stock register** as it is kept today: merged item cells, section headings, TOTAL rows, `50.0`-style sizes, "Large Size", and "Uvex (Clear and Dark)" with `51/82` (split into Clear 51 / Dark 82 and marked *Check*). It also reads the template (below) and any simple Item / Size / Quantity list.
3. On the review screen:
   - **OK**: matched with confidence.
   - **Check** (amber): matched, but please glance at it, e.g. a split figure, an item picked using its size, or a figure much higher than usual (likely a typo). Press **Looks right** to clear it.
   - **Fix** (red): the app wasn't sure. Pick the item or size from the drop-downs, correct the figure, or untick the line. **Apply** stays disabled until nothing is red.
   - If a workbook has several sheets, choose the right one with **Sheet**.
4. Choose what the figures mean:
   - **Stock count**: on-hand is *set* to the counted figure. A blank cell means *not counted* and leaves that size as it is. Tick **Treat empty cells as 0** only if blanks really mean none in stock.
   - **Delivery**: the figures are *added* to stock.
5. Press **Apply**.

**Templates:** *Blank template* downloads every item and size with empty Available / Defective columns. *Current stock as a sheet* downloads the same list filled with today's figures, so you can correct only what differs and upload it back.

### 9.2 Counting link (replaces the separate PPE Inventory app)
1. **Stock count → Counting link**: optionally name it (e.g. "Main store · October"), choose *Stock count* or *Delivery received*, choose how long it stays valid, then **Create link**. The link is copied for you. You can also share it with **WhatsApp**.
2. The person counting opens it on any phone, with no account needed. They see every item and size with **Available** and **Defective** boxes, in the same style as the old inventory app. Counts are saved on their phone as they type, so a refresh or lost signal doesn't lose work. They enter their name and press **Submit**.
3. It is a **blind count**: the page never shows current stock figures, so counts aren't biased. The link works **once** and stops working when it expires or is cancelled.
4. You get a notification if notifications are on (§8), and the tab shows a badge. Press **Review** on the link, check the lines, and **Apply**. Use **Discard** to reject a submitted count.

### 9.3 Defective stock
Stock rows now also hold a **defective** figure, shown on the dashboard cards and in the Inventory table. Defective items are never counted as available or issued; on-hand stays the figure that can be issued. Counts and deliveries set or add defective figures exactly like available ones.

### 9.4 Sheet changes (automatic)
- `Inventory` gains a 6th column, `qty_defective`. Its heading is written automatically the first time stock is saved, and existing rows count as 0 defective.
- A new tab, `Stock_Counts`, holds counting links and submitted counts. It is created automatically the first time a link is made.

No manual sheet edits and no new environment variables are needed. The old Apps Script inventory sheet is no longer used. Keep it as an archive if you like.
