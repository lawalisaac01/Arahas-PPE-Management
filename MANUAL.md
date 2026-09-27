# ARAHAS PPE Management System
### Deployment Guide & User Manual — v2 (Vercel + Google Sheets)

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
Open the live Google Sheet → `Inventory` tab → fill in `qty_on_hand` for each item/size from your current stock count (use `Investory - PPEs.xlsx` / `Combined PPE datasheet.xlsx` as the source). This is the only manual data entry needed at go-live — everything after this point is entered through the app so it stays audited.

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
