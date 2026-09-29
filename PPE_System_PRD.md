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

File name: package.json
Language: 
{
  "name": "arahas-ppe-system",
  "version": "1.1.0",
  "private": true,
  "description": "ARAHAS PPE requisition, approval & inventory system — static frontend + Vercel serverless API backed by Google Sheets.",
  "scripts": {
    "seed": "node scripts/setup-sheet.js",
    "test": "node scripts/selftest.js",
    "demo": "node scripts/demo-server.js"
  },
  "dependencies": {
    "googleapis": "^140.0.1",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "dotenv": "^16.4.5"
  }
}

File name: index.html
Language: 
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#164D3A">
<link rel="icon" href="/favicon.png">
<title>ARAHAS | PPE management</title>
<style>
:root{--bg:#f3f6f4;--surface:#fff;--surface-2:#f6f9f7;--ink:#14261e;--muted:#5a6e63;--line:#dde7e1;--brand:#164d3a;--brand-2:#1f6b52;--accent:#bbd65c;
--ok:#1e7b4c;--ok-bg:#e3f4ea;--warn:#a86a00;--warn-bg:#fff1d4;--bad:#b3372c;--bad-bg:#fbe5e2;--info:#245f8f;--info-bg:#e2eef8;--shadow:0 1px 2px #10281c12,0 6px 20px #10281c0d;
--radius:16px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
@media(prefers-color-scheme:dark){:root{--bg:#0e1813;--surface:#15241d;--surface-2:#1a2b23;--ink:#e6f0ea;--muted:#95aa9e;--line:#274035;--brand:#2a7d5f;--brand-2:#37a17c;--accent:#bbd65c;
--ok:#59d08f;--ok-bg:#153a29;--warn:#f0b34a;--warn-bg:#3c2f12;--bad:#ff8b7e;--bad-bg:#43201c;--info:#7fbdf0;--info-bg:#152f45;--shadow:0 1px 2px #0006}}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}button,input,select,textarea{font:inherit;color:inherit}
h1,h2,h3{line-height:1.2;margin:0}h1{font-size:1.55rem;letter-spacing:-.02em}h2{font-size:1.05rem}h3{font-size:.95rem}p{line-height:1.5;margin:.3rem 0}
.muted{color:var(--muted)}.small{font-size:.82rem}.right{text-align:right}.nowrap{white-space:nowrap}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
/* header */
header{position:sticky;top:0;z-index:20;background:linear-gradient(120deg,#0f3a2b,#164d3a 55%,#1f6b52);color:#fff;padding:.65rem max(1rem,calc((100vw - 1240px)/2));display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap}
.brand{display:flex;gap:.75rem;align-items:center}.brand img{width:54px;height:40px;object-fit:contain;background:#fff;border-radius:9px;padding:3px}
.brand strong{font-size:1.05rem;display:block}.brand small{color:#cfe4d6;font-size:.75rem}
.who{display:flex;gap:.6rem;align-items:center;font-size:.85rem;flex-wrap:wrap}.who .pill{background:#ffffff1f;border-radius:99px;padding:.25rem .7rem}
main{max-width:1240px;margin:auto;padding:1rem 1rem 3rem}
/* buttons & inputs */
.btn{cursor:pointer;border:1px solid transparent;border-radius:11px;padding:.6rem 1rem;background:var(--brand);color:#fff;font-weight:650;font-size:.9rem;transition:filter .15s,transform .05s}
.btn:hover{filter:brightness(1.1)}.btn:active{transform:translateY(1px)}.btn:disabled{opacity:.5;cursor:wait}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--ink)}.btn.soft{background:var(--ok-bg);color:var(--ok)}.btn.danger{background:var(--bad)}.btn.danger.ghost{background:transparent;color:var(--bad);border-color:var(--bad-bg)}
.btn.sm{padding:.34rem .65rem;font-size:.8rem;border-radius:9px}header .btn.ghost{border-color:#ffffff40;color:#fff}
input,select,textarea{width:100%;padding:.6rem .7rem;border:1px solid var(--line);border-radius:10px;background:var(--surface);min-height:40px}
input[type=checkbox]{width:1.15rem;height:1.15rem;min-height:0;accent-color:var(--brand)}
label{display:grid;gap:.3rem;font-weight:600;font-size:.82rem;color:var(--muted)}label.check{display:flex;align-items:center;gap:.6rem;color:var(--ink);font-weight:500;font-size:.9rem}
.qty{width:74px;text-align:center}
/* layout */
nav{display:flex;gap:.35rem;overflow:auto;padding:.2rem 0 .9rem;scrollbar-width:none}nav button{white-space:nowrap;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:99px;padding:.45rem .95rem;cursor:pointer;font-weight:600;font-size:.86rem}
nav button.active{background:var(--brand);border-color:var(--brand);color:#fff}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;margin:.2rem 0 1rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.1rem;margin:.8rem 0;box-shadow:var(--shadow)}
.card>h2:first-child{margin-bottom:.8rem}.card-head{display:flex;justify-content:space-between;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.6rem}
.grid{display:grid;gap:.8rem}.g-tiles{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.g-stock{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}.g-2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end}.row>label{flex:1;min-width:150px}.row>.btn{flex:0 0 auto}
.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:.6rem .65rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle;font-size:.88rem}th{font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--surface-2);white-space:nowrap}
tr:last-child td{border-bottom:0}
.badge{display:inline-flex;align-items:center;gap:.3rem;border-radius:99px;padding:.18rem .6rem;font-size:.75rem;font-weight:700;background:var(--ok-bg);color:var(--ok);white-space:nowrap}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.bad{background:var(--bad-bg);color:var(--bad)}.badge.info{background:var(--info-bg);color:var(--info)}.badge.mute{background:var(--surface-2);color:var(--muted);border:1px solid var(--line)}
/* live pill */
.live{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;color:var(--muted)}.live i{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 var(--ok);animation:pulse 2s infinite}.live.stale i{background:var(--warn);animation:none}
@keyframes pulse{70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
/* dashboard */
.tile{font:inherit;color:inherit;position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1rem 1.1rem;box-shadow:var(--shadow);text-align:left;cursor:default;display:block;width:100%}
.tile[data-act]{cursor:pointer}.tile:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--brand)}
.tile.warn:before{background:var(--warn)}.tile.bad:before{background:var(--bad)}.tile.info:before{background:var(--info)}
.tile .k{color:var(--muted);font-size:.8rem;font-weight:600}.tile .v{font-size:2.1rem;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin:.2rem 0}.tile .s{font-size:.78rem;color:var(--muted)}
.alerts{display:grid;gap:.4rem;margin:0;padding:0;list-style:none}.alerts li{display:flex;gap:.6rem;align-items:center;padding:.5rem .7rem;border-radius:10px;background:var(--surface-2);font-size:.88rem}
.chips{display:flex;gap:.4rem;flex-wrap:wrap}.chip{border:1px solid var(--line);background:var(--surface);border-radius:99px;padding:.32rem .8rem;font-size:.82rem;font-weight:600;cursor:pointer}.chip.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.stock{border:1px solid var(--line);border-radius:14px;padding:1rem;background:var(--surface);box-shadow:var(--shadow);border-top:4px solid var(--ok)}
.stock.low{border-top-color:var(--warn)}.stock.out,.stock.short{border-top-color:var(--bad)}
.stock .sh{display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start}.stock .name{font-weight:700}.stock .desc{font-size:.76rem;color:var(--muted);margin-top:.1rem}
.big{font-size:1.9rem;font-weight:800;letter-spacing:-.03em}.big small{font-size:.8rem;font-weight:600;color:var(--muted);letter-spacing:0}
.meter{display:flex;gap:.9rem;font-size:.78rem;color:var(--muted);margin:.1rem 0 .7rem;flex-wrap:wrap}.meter b{color:var(--ink)}
.bars{display:flex;gap:4px;overflow-x:auto;padding-bottom:.2rem}.bar{display:flex;flex-direction:column;align-items:center;min-width:24px;flex:1}
.bar .track{height:56px;width:100%;display:flex;align-items:flex-end}.bar i{display:block;width:100%;border-radius:4px 4px 0 0;background:var(--ok)}
.bar.low i{background:var(--warn)}.bar.out i{background:var(--bad)}.bar.out .q{color:var(--bad)}.bar .q{font-size:.68rem;font-weight:700}.bar .s{font-size:.66rem;color:var(--muted);white-space:nowrap}
.trend{display:flex;align-items:flex-end;gap:5px;height:110px}.trend div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;font-size:.65rem;color:var(--muted)}.trend i{display:block;width:100%;background:var(--brand-2);border-radius:4px 4px 0 0;min-height:2px}
.pipe{display:flex;height:14px;border-radius:99px;overflow:hidden;background:var(--surface-2);margin:.5rem 0}.pipe i{display:block}
.legend{display:flex;gap:1rem;flex-wrap:wrap;font-size:.8rem}.legend span:before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--c);margin-right:.35rem}
/* kits */
.kit-table td{padding:.45rem .5rem}.kit-add{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end;margin-top:.7rem;padding-top:.7rem;border-top:1px dashed var(--line)}.kit-add label{flex:1;min-width:170px}
.notice{padding:.65rem .85rem;border-radius:11px;font-size:.87rem;background:var(--info-bg);color:var(--info)}.notice.warn{background:var(--warn-bg);color:var(--warn)}
.pick{display:grid;grid-template-columns:auto 1fr auto auto;gap:.6rem;align-items:center;padding:.45rem .3rem;border-bottom:1px solid var(--line)}.pick:last-child{border:0}
.actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.9rem;padding-top:.9rem;border-top:1px solid var(--line)}
.line{display:grid;grid-template-columns:minmax(200px,1fr) minmax(170px,260px);gap:1rem;align-items:center;padding:.7rem .2rem;border-top:1px solid var(--line)}
.rolecard h2{display:flex;justify-content:space-between;align-items:center}
/* dialog, toast, login */
dialog{border:1px solid var(--line);border-radius:18px;padding:1.3rem;width:min(96vw,860px);max-height:92vh;background:var(--surface);color:var(--ink);box-shadow:0 22px 70px #0a2d2066}dialog::backdrop{background:#0a2d20b0}
.dialog-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}
#toast{position:fixed;left:50%;bottom:1.2rem;transform:translate(-50%,20px);opacity:0;pointer-events:none;background:#14261e;color:#fff;padding:.7rem 1.1rem;border-radius:12px;z-index:50;max-width:min(92vw,560px);font-size:.9rem;box-shadow:0 10px 30px #0006;transition:.25s}
#toast.show{opacity:1;transform:translate(-50%,0)}#toast.error{background:var(--bad);color:#fff}
.login{max-width:420px;margin:8vh auto}.login img{width:120px;height:90px;object-fit:contain;display:block;margin:0 auto .5rem}.login form{display:grid;gap:1rem;margin-top:1rem}
footer{text-align:center;color:var(--muted);padding:1.5rem 1rem;font-size:.8rem}
.empty{padding:1.4rem;text-align:center;color:var(--muted)}
@media(max-width:650px){main{padding:.7rem .7rem 3rem}.card{padding:.9rem}.line{grid-template-columns:1fr}.row>label{min-width:100%}.row>.btn{width:100%}.pick{grid-template-columns:auto 1fr}.pick>*:nth-child(n+3){grid-column:2}}
@media print{header,nav,.no-print,footer,.live,#toast{display:none!important}body{background:#fff}.card{box-shadow:none}}
</style>
</head>
<body>
<header>
  <div class="brand"><img src="/favicon.png" alt="ARAHAS logo"><div><strong>ARAHAS PPE</strong><small>QHSE · Requisition, approval &amp; inventory</small></div></div>
  <div class="who" id="identity"></div>
</header>
<main id="app"></main>
<dialog id="dlg"></dialog>
<div id="toast" role="status" aria-live="polite"></div>
<footer>Powered by GETs 2025 Set</footer>
<script>
"use strict";
/* ───────── state ───────── */
const S={auth:null,data:null,tab:'Dashboard',busy:false,updated:0,dashFilter:'all',dashQ:'',dlg:null};
let X={};                       // derived indexes, rebuilt whenever data changes
const ST={PENDING:'Pending',AWAIT:'Approved — Pending Collection',PART:'Partially Collected',DONE:'Collected'};
const ROLE_SEED=['Field Officer','Coordinator','Supervisor','Other'];
const SIZE_ORDER=['S','M','L','XL','XXL','XXXL','XXXXL'];
const REFRESH_MS=60000;         // live refresh cadence (1 sheet read/min per open screen — far inside Google's quota)

/* ───────── tiny helpers ───────── */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n||0).toLocaleString();
const isAdmin=()=>S.auth?.role==='Admin';
const day=t=>String(t||'').slice(0,10);
function ago(ts){const s=Math.max(0,Math.round((Date.now()-ts)/1000));return s<10?'just now':s<60?s+'s ago':s<3600?Math.floor(s/60)+' min ago':Math.floor(s/3600)+' h ago'}
let toastT;function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.className='show'+(error?' error':'');clearTimeout(toastT);toastT=setTimeout(()=>t.className='',error?7000:3500)}
const sizeSort=(a,b)=>{const x=a.size,y=b.size,nx=parseFloat(x),ny=parseFloat(y);if(!isNaN(nx)&&!isNaN(ny))return nx-ny;const ix=SIZE_ORDER.indexOf(String(x).toUpperCase()),iy=SIZE_ORDER.indexOf(String(y).toUpperCase());if(ix>-1&&iy>-1)return ix-iy;return String(x).localeCompare(String(y))};

/* ───────── derived data ───────── */
function reindex(){
  const d=S.data;
  X.items=d.Item_Catalog.filter(i=>i.active);
  X.item=new Map(d.Item_Catalog.map(i=>[i.item_id,i]));
  const dup={};d.Item_Catalog.forEach(i=>dup[i.item_category]=(dup[i.item_category]||0)+1);
  // two catalogue items can share a category (e.g. Safety Joggers vs Redwings): add the brand so they're distinguishable
  X.label=new Map(d.Item_Catalog.map(i=>[i.item_id,dup[i.item_category]>1?`${i.item_category} · ${i.item_description.split(' — ')[1]||i.item_description}`:i.item_category]));
  X.empE=new Map(d.Employees.filter(e=>e.employee_id).map(e=>[e.employee_id,e]));
  X.empI=new Map(d.Employees.map(e=>[e.internal_id,e]));
  X.stock=stockMap();
}
const label=id=>X.label.get(id)||id;
const uom=id=>X.item.get(id)?.uom||'units';
const emp=id=>X.empE.get(id);
const roles=()=>[...new Set([...ROLE_SEED,...S.data.Entitlement_Rules.map(r=>r.role),...S.data.Employees.map(e=>e.role)])].filter(Boolean).sort((a,b)=>ROLE_SEED.indexOf(a)-ROLE_SEED.indexOf(b)||a.localeCompare(b));
const kitFor=role=>S.data.Entitlement_Rules.filter(r=>r.role===role&&r.active&&X.item.get(r.item_id)?.active);
const draftsOf=iid=>S.data.Issuance_Log.filter(l=>l.item_status==='Draft'&&l.employee_id===iid);
const linesOf=eid=>eid?S.data.Issuance_Log.filter(l=>l.employee_id===eid&&l.item_status!=='Draft'):[];
function holdings(eid){ // everything collected so far, per PPE item — an employee can hold any number of items
  const m=new Map();
  linesOf(eid).filter(l=>l.item_status==='Collected').forEach(l=>{const h=m.get(l.item_id)||{item_id:l.item_id,qty:0,sizes:new Set(),last:''};h.qty+=l.qty;if(l.size)h.sizes.add(l.size);if(l.date_issued>h.last)h.last=l.date_issued;m.set(l.item_id,h)});
  return [...m.values()];
}
function stockMap(){
  const d=S.data,m=new Map();
  d.Item_Catalog.filter(i=>i.active).forEach(i=>m.set(i.item_id,{item:i,rows:[],total:0,committed:0}));
  d.Inventory.forEach(r=>{const s=m.get(r.item_id);if(s){s.rows.push(r);s.total+=r.qty_on_hand}});
  d.Issuance_Log.forEach(l=>{if(l.item_status==='Pending'){const s=m.get(l.item_id);if(s)s.committed+=l.qty}});
  m.forEach(s=>{
    s.rows.sort(sizeSort);s.available=s.total-s.committed;
    // a size never counted (no last_updated) is "not stocked", not "low" — avoids alarms for sizes you never carry
    s.lowRows=s.rows.filter(r=>r.qty_on_hand<r.low_stock_threshold&&(r.qty_on_hand>0||r.last_updated));
    s.state=s.total===0?'out':s.available<0?'short':s.lowRows.length?'low':'ok';
  });
  return m;
}
function stockChip(itemId,wanted=1){
  const s=X.stock.get(itemId);if(!s)return '';
  if(s.total===0)return '<span class="badge bad">Out of stock</span>';
  if(s.available<wanted)return `<span class="badge warn">Only ${num(s.available)} free</span>`;
  return `<span class="badge">${num(s.available)} free</span>`;
}
const bdg=(t,c='')=>`<span class="badge ${c}">${esc(t)}</span>`;
const statusBadge=x=>x===ST.PENDING?bdg('Awaiting approval','info'):x===ST.DONE?bdg(x):bdg(x,'warn');           // employee status
const lineBadge=x=>x==='Pending'?bdg('Awaiting collection','warn'):x==='Collected'?bdg('Collected'):bdg(x,'mute');   // issuance line
const reqBadge=x=>x==='Approved'?bdg(x):x==='Rejected'?bdg(x,'bad'):bdg(x,'warn');                                 // replacement request

/* ───────── API ───────── */
let lastPayload=null;
async function call(fn,...args){
  let r;
  try{r=await fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fn,args}),cache:'no-store',signal:AbortSignal.timeout(55000)})}
  catch(e){throw Error(e.name==='TimeoutError'?'Request timed out. Check the record before repeating an action.':'Network unavailable. Check your connection.')}
  let p;try{p=await r.json()}catch{throw Error('The server did not return valid data.')}
  if(!r.ok||!p.ok)throw Error(p.error||'The request failed.');
  lastPayload=p;return p.result;
}
function setData(snap){S.data=snap;S.updated=Date.now();reindex()}
async function run(fn,...args){
  if(S.busy)return;S.busy=true;document.body.style.cursor='progress';
  try{const result=await call(fn,S.auth.token,...args);setData(lastPayload.snapshot);keepScroll(render);toast('Saved.');return result??true}
  catch(e){if(/session/i.test(e.message)){toast(e.message,true);return signOut(true)}toast(e.message,true)}
  finally{S.busy=false;document.body.style.cursor=''}
}
function keepScroll(f){const y=scrollY;f();scrollTo(0,y)}
async function refresh(manual){
  if(!S.auth||S.busy)return;
  try{const before=JSON.stringify(S.data);await call('snapshot',S.auth.token);const snap=lastPayload.snapshot;S.updated=Date.now();
    if(JSON.stringify(snap)!==before){S.data=snap;reindex();if(manual||!userIsEditing())keepScroll(render)}
    else tickLive();
    if(manual)toast('Up to date.')}
  catch(e){if(/session/i.test(e.message))return signOut(true);tickLive(true);if(manual)toast(e.message,true)}
}
const userIsEditing=()=>{const a=document.activeElement;return $('#dlg').open||(a&&/INPUT|SELECT|TEXTAREA/.test(a.tagName)&&$('#app').contains(a))};
function tickLive(failed){const p=$('#live');if(!p)return;const stale=failed||Date.now()-S.updated>REFRESH_MS*2.5;p.className='live'+(stale?' stale':'');$('#liveTxt').textContent=(stale?'Connection issue · last update ':'Live · updated ')+ago(S.updated)}
setInterval(()=>{if(S.auth&&!document.hidden)refresh()},REFRESH_MS);
setInterval(()=>S.auth&&tickLive(),10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.auth&&Date.now()-S.updated>30000)refresh()});

/* ───────── auth ───────── */
function loginView(){
  $('#identity').innerHTML='';
  $('#app').innerHTML=`<section class="card login"><img src="/favicon.png" alt="ARAHAS"><h1 style="text-align:center">Sign in to PPE management</h1><p class="muted" style="text-align:center">Authorized QHSE staff only.</p>
  <form id="loginForm"><label>Username<input id="u" required autocomplete="username"></label><label>Password<input id="p" type="password" required autocomplete="current-password"></label><button class="btn">Sign in</button></form></section>`;
  $('#loginForm').onsubmit=async e=>{e.preventDefault();const b=$('button',e.target);b.disabled=true;
    try{S.auth=await call('signIn',$('#u').value,$('#p').value);setData(lastPayload.snapshot);S.tab='Dashboard';render()}
    catch(err){toast(err.message,true)}finally{b.disabled=false}};
}
async function signOut(silent){try{if(!silent)await call('signOut',S.auth.token)}catch{}S.auth=null;S.data=null;S.dlg=null;$('#dlg').open&&$('#dlg').close();loginView()}

/* ───────── shell ───────── */
const TABS_ADMIN=['Dashboard','Employees','Rules','Inventory','Replacements','Reports'],TABS_STORE=['Dashboard','Collections','Employees','Replacements','My activity'];
const VIEWS={Dashboard:viewDashboard,Employees:viewEmployees,Rules:viewRules,Inventory:viewInventory,Collections:viewCollections,Replacements:viewReplacements,Reports:viewReports,'My activity':viewActivity};
function render(){
  const tabs=isAdmin()?TABS_ADMIN:TABS_STORE;if(!tabs.includes(S.tab))S.tab='Dashboard';
  $('#identity').innerHTML=`<span class="pill">${esc(S.auth.username)} · ${esc(S.auth.role)}</span><button class="btn ghost sm" data-act="signout">Sign out</button>`;
  $('#app').innerHTML=`<nav aria-label="Main">${tabs.map(t=>`<button class="${t===S.tab?'active':''}" data-tab="${t}">${t}${badgeFor(t)}</button>`).join('')}</nav><div id="view"></div>`;
  VIEWS[S.tab]();paintDialog();tickLive();
}
function badgeFor(t){ // small counters on tabs so nothing waiting is missed
  const d=S.data;let n=0;
  if(t==='Employees'&&isAdmin())n=d.Employees.filter(e=>e.status===ST.PENDING).length;
  if(t==='Collections')n=new Set(d.Issuance_Log.filter(l=>l.item_status==='Pending').map(l=>l.employee_id)).size;
  if(t==='Replacements'&&isAdmin())n=d.Replacement_Requests.filter(r=>r.status==='Pending').length;
  return n?` <span class="badge warn" style="padding:.05rem .45rem">${n}</span>`:'';
}
const liveBar=()=>`<span class="live" id="live"><i></i><span id="liveTxt">Live</span></span> <button class="btn ghost sm no-print" data-act="refresh">↻ Refresh</button>`;
function table(headers,rows,empty='No records yet.') { return `<div class="scroll"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`}
const roleSelect=(id,sel,extra='')=>`<select id="${id}" ${extra}>${roles().map(r=>`<option ${r===sel?'selected':''}>${esc(r)}</option>`).join('')}</select>`;

/* ───────── DASHBOARD ───────── */
function viewDashboard(){
  const d=S.data,items=[...X.stock.values()];
  const pendApproval=d.Employees.filter(e=>e.status===ST.PENDING).length;
  const open=d.Issuance_Log.filter(l=>l.item_status==='Pending');
  const waiting=new Set(open.map(l=>l.employee_id)).size;
  const cnt=s=>items.filter(i=>i.state===s).length,out=cnt('out'),low=cnt('low'),short=cnt('short');
  const since=Date.now()-30*864e5;
  const issued30=d.Issuance_Log.filter(l=>l.item_status==='Collected'&&Date.parse(l.date_issued)>=since).length;
  const totalUnits=items.reduce((a,i)=>a+i.total,0);
  const rank={short:0,out:1,low:2,ok:3};
  const attention=items.filter(i=>i.state!=='ok').sort((a,b)=>rank[a.state]-rank[b.state]||b.committed-a.committed);
  const alertText=i=>i.state==='short'?`<b>${esc(label(i.item.item_id))}</b> — ${num(i.committed)} reserved for pending collections but only ${num(i.total)} on hand`
    :i.state==='out'?`<b>${esc(label(i.item.item_id))}</b> — ${i.rows.length?'out of stock':'no stock recorded yet'}${i.committed?` · ${num(i.committed)} waiting to be issued`:''}`
    :`<b>${esc(label(i.item.item_id))}</b> — ${i.lowRows.length} size${i.lowRows.length>1?'s':''} below alert level (${i.lowRows.slice(0,5).map(r=>esc(r.size)).join(', ')}${i.lowRows.length>5?'…':''})`;
  const q=S.dashQ.toLowerCase();
  const shown=items.filter(i=>(S.dashFilter==='all'||(S.dashFilter==='attn'?i.state!=='ok':i.state==='ok'))&&(!q||label(i.item.item_id).toLowerCase().includes(q)||i.item.item_description.toLowerCase().includes(q)));
  // 14-day issuance trend (issued lines per day)
  const days=[...Array(14)].map((_,k)=>{const t=new Date(Date.now()-(13-k)*864e5);return t.toISOString().slice(0,10)});
  const perDay=days.map(k=>d.Issuance_Log.filter(l=>l.item_status==='Collected'&&day(l.date_issued)===k).length),maxDay=Math.max(1,...perDay);
  // employee pipeline
  const pipe=[[ST.PENDING,'Awaiting approval','var(--info)'],[ST.AWAIT,'Awaiting collection','var(--warn)'],[ST.PART,'Partly collected','#d99a2b'],[ST.DONE,'Fully collected','var(--ok)']].map(([k,l,c])=>[l,c,d.Employees.filter(e=>e.status===k).length]);
  const tot=Math.max(1,pipe.reduce((a,p)=>a+p[2],0));
  $('#view').innerHTML=`
  <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Live stock position and what is waiting on people.</p></div><div>${liveBar()}</div></div>
  <div class="grid g-tiles">
    <button class="tile info" ${isAdmin()?'data-act="goto" data-tab="Employees"':''}><div class="k">Awaiting approval</div><div class="v">${pendApproval}</div><div class="s">new employees to approve</div></button>
    <button class="tile warn" ${!isAdmin()?'data-act="goto" data-tab="Collections"':''}><div class="k">Awaiting collection</div><div class="v">${open.length}</div><div class="s">PPE lines · ${waiting} ${waiting===1?'person':'people'}</div></button>
    <button class="tile ${short+out?'bad':low?'warn':''}" data-act="filter" data-f="attn"><div class="k">Stock alerts</div><div class="v">${short+out+low}</div><div class="s">${out} out · ${short} short · ${low} low</div></button>
    <div class="tile"><div class="k">Issued · last 30 days</div><div class="v">${issued30}</div><div class="s">PPE lines handed out</div></div>
  </div>
  ${totalUnits===0?`<div class="notice warn" style="margin-top:.8rem"><b>No stock has been recorded yet.</b> Every count is zero until you add opening stock — ${isAdmin()?'go to <b>Inventory</b> and enter your verified counts.':'ask the admin to enter opening counts under Inventory.'}</div>`:''}
  <section class="card"><div class="card-head"><h2>Needs attention</h2><span class="muted small">Reserved = approved but not yet collected</span></div>
    ${attention.length?`<ul class="alerts">${attention.slice(0,6).map(i=>`<li><span class="badge ${i.state==='low'?'warn':'bad'}">${i.state==='short'?'Short':i.state==='out'?'Out':'Low'}</span><span>${alertText(i)}</span></li>`).join('')}${attention.length>6?`<li class="muted">+ ${attention.length-6} more — see the stock cards below</li>`:''}</ul>`:'<div class="empty">Everything is stocked above alert levels and covers pending collections.</div>'}
  </section>
  <div class="card-head" style="margin-top:1.2rem"><h2>Current stock</h2><div class="row no-print" style="align-items:center">
    <div class="chips">${[['all','All',items.length],['attn','Needs attention',attention.length],['ok','Healthy',items.length-attention.length]].map(([k,l,n])=>`<button class="chip ${S.dashFilter===k?'on':''}" data-act="filter" data-f="${k}">${l} · ${n}</button>`).join('')}</div>
    <input id="dashQ" placeholder="Search PPE…" value="${esc(S.dashQ)}" style="max-width:220px"></div></div>
  <div class="grid g-stock">${shown.map(stockCard).join('')||'<div class="card empty">No PPE matches.</div>'}</div>
  <div class="grid g-2" style="margin-top:.4rem">
    <section class="card"><h2>Issued per day · last 14 days</h2><div class="trend" role="img" aria-label="PPE lines issued per day for the last 14 days">${perDay.map((n,k)=>`<div title="${days[k]}: ${n}"><span>${n||''}</span><i style="height:${Math.round(n/maxDay*80)}%"></i><span>${days[k].slice(8)}</span></div>`).join('')}</div></section>
    <section class="card"><h2>Employee pipeline</h2><div class="pipe">${pipe.map(p=>`<i style="width:${p[2]/tot*100}%;background:${p[1]}" title="${p[0]}: ${p[2]}"></i>`).join('')}</div><div class="legend">${pipe.map(p=>`<span style="--c:${p[1]}">${p[0]} · <b>${p[2]}</b></span>`).join('')}</div></section>
  </div>
  ${isAdmin()?`<section class="card"><h2>Recent stock movements</h2>${table(['When','Item','Size','Change','Reason','By'],d.Stock_Movements.slice(-10).reverse().map(m=>[esc(String(m.timestamp).slice(0,16).replace('T',' ')),esc(label(m.item_id)),esc(m.size),`<b style="color:var(--${m.delta<0?'bad':'ok'})">${m.delta>0?'+':''}${m.delta}</b>`,esc(m.reason),esc(m.actor)]))}</section>`:''}`;
  const dq=$('#dashQ');dq.oninput=()=>{S.dashQ=dq.value;const pos=dq.selectionStart;viewDashboard();const n=$('#dashQ');n.focus();n.setSelectionRange(pos,pos)};
}
function stockCard(i){
  const max=Math.max(1,...i.rows.map(r=>r.qty_on_hand));
  const bars=i.rows.map(r=>{const q=r.qty_on_hand,cls=q===0?'out':q<r.low_stock_threshold?'low':'',h=q===0?4:Math.max(10,Math.round(q/max*100));
    return `<div class="bar ${cls}" title="Size ${esc(r.size)}: ${q} on hand · alert below ${r.low_stock_threshold}"><span class="q">${q}</span><div class="track"><i style="height:${h}%"></i></div><span class="s">${esc(r.size)}</span></div>`}).join('');
  const badge={ok:'<span class="badge">Healthy</span>',low:`<span class="badge warn">${i.lowRows.length} size${i.lowRows.length>1?'s':''} low</span>`,out:'<span class="badge bad">Out of stock</span>',short:`<span class="badge bad">Short by ${num(-i.available)}</span>`}[i.state];
  return `<article class="stock ${i.state}"><div class="sh"><div><div class="name">${esc(label(i.item.item_id))}</div><div class="desc">${esc(i.item.item_description.slice(0,70))}${i.item.item_description.length>70?'…':''}</div></div>${badge}</div>
  <div class="big" style="margin:.5rem 0 .1rem">${num(i.total)} <small>${esc(i.item.uom)} on hand</small></div>
  <div class="meter"><span>Reserved <b>${num(i.committed)}</b></span><span>Free to allocate <b style="color:${i.available<0?'var(--bad)':'inherit'}">${num(i.available)}</b></span></div>
  ${i.rows.length?`<div class="bars">${bars}</div>`:'<div class="muted small">No sizes set up for this item.</div>'}</article>`;
}

/* ───────── EMPLOYEES ───────── */
function kitPreview(role){
  const k=kitFor(role);
  if(!k.length)return `<div class="notice warn">No PPE is defined for <b>${esc(role)}</b> yet. You can still add this person and pick PPE manually, or set the role's standard kit under <b>Rules</b>.</div>`;
  return `<div class="notice"><b>${esc(role)}</b> standard kit — assigned automatically (editable before approval):<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">${k.map(r=>`<span class="badge mute">${esc(label(r.item_id))} × ${r.default_qty}</span>`).join('')}</div></div>`;
}
function pendingCard(e){
  const dr=draftsOf(e.internal_id),inKit=new Set(dr.map(l=>l.item_id)),free=X.items.filter(i=>!inKit.has(i.item_id));
  return `<article class="card" data-iid="${esc(e.internal_id)}">
  <div class="card-head"><div><h2 style="margin:0">${esc(e.name)}</h2><span class="muted small">Added ${esc(e.date_added)} · standard kit follows the role</span></div>
    <label style="min-width:200px">Role <select data-change="role" data-iid="${esc(e.internal_id)}">${roles().map(r=>`<option ${r===e.role?'selected':''}>${esc(r)}</option>`).join('')}</select></label></div>
  ${!dr.length?`<div class="notice warn">${kitFor(e.role).length?'This person has no draft kit yet.':`No PPE is defined for ${esc(e.role)}.`} Reset to the role standard, or add items below.</div>`:''}
  ${dr.length?`<div class="scroll"><table class="kit-table"><thead><tr><th>PPE item</th><th>Qty (${"per person"})</th><th>Stock</th><th></th></tr></thead><tbody>${dr.map(l=>`<tr><td><b>${esc(label(l.item_id))}</b><div class="muted small">${esc(uom(l.item_id))}</div></td>
    <td><input class="qty" type="number" min="1" max="1000" step="1" value="${l.qty}" data-change="qty" data-iid="${esc(e.internal_id)}" data-item="${esc(l.item_id)}" aria-label="Quantity of ${esc(label(l.item_id))}"></td><td>${stockChip(l.item_id,l.qty)}</td>
    <td class="right"><button class="btn ghost danger sm" data-act="rmdraft" data-iid="${esc(e.internal_id)}" data-item="${esc(l.item_id)}" aria-label="Remove ${esc(label(l.item_id))}">Remove</button></td></tr>`).join('')}</tbody></table></div>`:''}
  <div class="kit-add"><label>Add another PPE item (from inventory)<select data-add-item>${free.map(i=>{const s=X.stock.get(i.item_id);return `<option value="${esc(i.item_id)}">${esc(label(i.item_id))} — ${s?num(s.available):0} free</option>`}).join('')||'<option value="">All items already in the kit</option>'}</select></label>
    <label style="max-width:110px">Qty<input class="qty" style="width:100%" type="number" min="1" max="1000" value="1" data-add-qty></label><button class="btn soft" data-act="adddraft" data-iid="${esc(e.internal_id)}" ${free.length?'':'disabled'}>+ Add to kit</button></div>
  <div class="actions"><button class="btn" data-act="approve" data-iid="${esc(e.internal_id)}">Approve &amp; assign ID (${dr.length} item${dr.length===1?'':'s'})</button>
    <button class="btn ghost" data-act="resetkit" data-iid="${esc(e.internal_id)}">↺ Reset to ${esc(e.role)} standard</button><button class="btn ghost danger" data-act="discard" data-iid="${esc(e.internal_id)}">Discard employee</button></div></article>`;
}
function viewEmployees(){
  const d=S.data,admin=isAdmin(),pending=d.Employees.filter(e=>e.status===ST.PENDING);
  $('#view').innerHTML=`<div class="page-head"><div><h1>Employees</h1><p class="muted">${admin?'Choose a role and the standard PPE is assigned automatically. Adjust it, then give final approval.':'Look up any employee and what they hold.'}</p></div>${liveBar()}</div>
  ${admin?`<section class="card"><h2>Add employee</h2><form class="row" id="addEmp"><label>Full name<input id="en" required minlength="3" maxlength="120" autocomplete="off"></label><label>Role${roleSelect('er',roles()[0])}</label><button class="btn">Add &amp; assign role kit</button></form><div id="kitPrev" style="margin-top:.8rem"></div></section>
  <h2 style="margin:1.2rem 0 .2rem">Pending approval <span class="badge info">${pending.length}</span></h2>${pending.map(pendingCard).join('')||'<section class="card empty">No employees waiting for approval.</section>'}`:''}
  <section class="card"><div class="card-head"><h2 style="margin:0">Employee directory</h2><input id="find" placeholder="Search name, ID or role…" style="max-width:280px"></div><div id="dir"></div></section>`;
  if(admin){const rs=$('#er'),pv=()=>$('#kitPrev').innerHTML=kitPreview(rs.value);rs.onchange=pv;pv();
    $('#addEmp').onsubmit=async ev=>{ev.preventDefault();const n=$('#en').value.trim().replace(/\s+/g,' ');
      if(d.Employees.some(e=>e.name.toLowerCase()===n.toLowerCase())&&!confirm(`"${n}" already exists in the directory. Add another person with the same name?`))return;
      const r=await run('addEmployee',n,rs.value);if(r&&r!==true)toast(r.drafted?`Added — ${r.drafted} PPE item(s) assigned from the ${rs.value} role.`:`Added — no PPE is defined for ${rs.value} yet; add items to the kit.`)} }
  const dir=()=>{const q=$('#find').value.toLowerCase();
    $('#dir').innerHTML=table(['ID','Name','Role','Status','Holds','Waiting',''],d.Employees.filter(e=>`${e.name} ${e.employee_id} ${e.role}`.toLowerCase().includes(q)).map(e=>{
      const h=holdings(e.employee_id),pend=linesOf(e.employee_id).filter(l=>l.item_status==='Pending').length,canDel=admin&&!(e.employee_id&&linesOf(e.employee_id).some(l=>l.item_status==='Collected'));
      return [esc(e.employee_id||'—'),`<b>${esc(e.name)}</b>`,esc(e.role),statusBadge(e.status),e.employee_id?`${h.length} PPE type${h.length===1?'':'s'}`:'—',pend?`<span class="badge warn">${pend}</span>`:'—',
       `<span class="nowrap"><button class="btn ghost sm" data-act="open" data-iid="${esc(e.internal_id)}">Open</button> ${admin?`<button class="btn ghost sm" data-act="edit" data-iid="${esc(e.internal_id)}">Edit</button>`:''} ${canDel?`<button class="btn ghost danger sm" data-act="delemp" data-iid="${esc(e.internal_id)}">Delete</button>`:''}</span>`]}))};
  $('#find').oninput=dir;dir();
}

/* employee dialog: holdings + add more PPE + history */
function paintDialog(){
  const dlg=$('#dlg');if(!S.dlg){return}
  const e=X.empI.get(S.dlg.iid);if(!e){dlg.open&&dlg.close();S.dlg=null;return}
  const admin=isAdmin(),lines=linesOf(e.employee_id),hold=holdings(e.employee_id),pend=lines.filter(l=>l.item_status==='Pending');
  let html='';
  if(S.dlg.type==='edit'){
    html=`<h2>Edit employee</h2><form id="editForm" style="display:grid;gap:1rem;margin-top:.8rem"><label>Full name<input name="n" value="${esc(e.name)}" required minlength="3" maxlength="120"></label>
    <label>Role ${e.status===ST.PENDING?`<select name="r">${roles().map(r=>`<option ${r===e.role?'selected':''}>${esc(r)}</option>`).join('')}</select>`:`<input value="${esc(e.role)}" disabled>`}</label>
    ${e.status===ST.PENDING?'<p class="muted small">Changing the role replaces the draft kit with the new role\'s standard kit.</p>':'<p class="muted small">Role is locked after approval so history stays accurate.</p>'}
    <div class="dialog-actions"><button type="button" class="btn ghost" data-act="closedlg">Cancel</button><button class="btn">Save changes</button></div></form>`;
  }else{
    html=`<div class="card-head"><div><h2 style="font-size:1.3rem">${esc(e.name)}</h2><span class="muted">${esc(e.employee_id||'Awaiting approval')} · ${esc(e.role)} · ${statusBadge(e.status)}</span></div><button class="btn ghost sm" data-act="closedlg">Close</button></div>
    <h3 style="margin:.8rem 0 .4rem">Issued to date <span class="badge">${hold.length} PPE type${hold.length===1?'':'s'}</span></h3>
    ${table(['PPE','Total issued','Size(s)','Last issued'],hold.map(h=>[`<b>${esc(label(h.item_id))}</b>`,`${num(h.qty)} ${esc(uom(h.item_id))}`,esc([...h.sizes].join(', ')||'—'),esc(day(h.last))]),'Nothing collected yet.')}
    ${pend.length?`<h3 style="margin:1rem 0 .4rem">Waiting to be collected <span class="badge warn">${pend.length}</span></h3>${table(['PPE','Qty','Batch',''],pend.map(l=>[`<b>${esc(label(l.item_id))}</b>`,num(l.qty),esc(l.batch_type),admin?`<button class="btn ghost danger sm" data-act="rmline" data-line="${esc(l.line_id)}">Remove</button>`:'']))}`:''}
    ${admin&&e.employee_id?addPpePanel(e):''}
    <h3 style="margin:1rem 0 .4rem">Full history</h3>${table(['Item','Size','Qty','Status','Date','By',admin?'':null].filter(x=>x!==null),lines.slice().reverse().map(l=>[esc(label(l.item_id)),esc(l.size||'—'),num(l.qty),lineBadge(l.item_status),esc(day(l.date_issued)||'—'),esc(l.issued_by||'—'),...(admin?[l.item_status==='Collected'?`<button class="btn ghost danger sm" data-act="undo" data-line="${esc(l.line_id)}">Undo</button>`:'']:[])]),'No records yet.')}`;
  }
  const top=dlg.scrollTop;dlg.innerHTML=html;if(!dlg.open)dlg.showModal();dlg.scrollTop=top;
  const ef=$('#editForm',dlg);if(ef)ef.onsubmit=async ev=>{ev.preventDefault();const f=ev.target;const r=await run('editEmployee',e.internal_id,f.n.value.trim(),f.r?f.r.value:e.role);if(r){S.dlg=null;dlg.close()}};
}
function addPpePanel(e){
  return `<details style="margin-top:1rem" ${S.dlg.addOpen?'open':''}><summary style="cursor:pointer;font-weight:700">+ Assign more PPE to ${esc(e.name.split(' ')[0])}</summary>
  <p class="muted small">Tick any PPE to add to what they already hold. They are queued for the store keeper to issue.</p>
  <div id="addPanel">${X.items.map(i=>`<div class="pick"><input type="checkbox" data-pick value="${esc(i.item_id)}" aria-label="${esc(label(i.item_id))}"><div><b>${esc(label(i.item_id))}</b><div class="muted small">${esc(i.uom)}</div></div><input class="qty" type="number" min="1" max="1000" value="1" data-pickqty="${esc(i.item_id)}">${stockChip(i.item_id)}</div>`).join('')}</div>
  <label style="margin-top:.6rem">Reason (optional)<input id="addReason" maxlength="80" placeholder="e.g. site change, extra kit"></label>
  <div class="actions"><button class="btn" data-act="addppe" data-iid="${esc(e.internal_id)}">Assign selected PPE</button></div></details>`;
}

/* ───────── RULES ───────── */
function viewRules(){
  const d=S.data,byRole=roles().map(r=>[r,d.Entitlement_Rules.filter(x=>x.role===r)]);
  $('#view').innerHTML=`<div class="page-head"><div><h1>Role kits</h1><p class="muted">The standard PPE for each role. It is assigned automatically when you add a person with that role. Changes never alter people already approved.</p></div>${liveBar()}</div>
  <section class="card"><h2>Add PPE to a role</h2><form class="row" id="ruleForm"><label>Role (pick or type a new one)<input id="rr" list="roleList" required maxlength="40" value="${esc(roles()[0])}"><datalist id="roleList">${roles().map(r=>`<option value="${esc(r)}">`).join('')}</datalist></label>
  <label>PPE item<select id="ri">${X.items.map(x=>`<option value="${esc(x.item_id)}">${esc(label(x.item_id))}</option>`).join('')}</select></label><label style="max-width:110px">Quantity<input id="rq" type="number" min="1" max="1000" value="1" required></label><button class="btn">Save</button></form></section>
  ${byRole.map(([r,rs])=>`<section class="card rolecard"><h2>${esc(r)} <span class="badge ${rs.some(x=>x.active)?'':'mute'}">${rs.filter(x=>x.active).length} active item${rs.filter(x=>x.active).length===1?'':'s'}</span></h2>
  ${rs.length?`<div class="scroll"><table><thead><tr><th>PPE item</th><th>Qty</th><th>Active</th><th></th></tr></thead><tbody>${rs.map(x=>`<tr><td><b>${esc(label(x.item_id))}</b></td><td><input class="qty" type="number" min="1" max="1000" value="${x.default_qty}" data-change="rulqty" data-role="${esc(r)}" data-item="${esc(x.item_id)}"></td>
  <td><input type="checkbox" ${x.active?'checked':''} data-change="rulact" data-role="${esc(r)}" data-item="${esc(x.item_id)}" aria-label="Active"></td><td class="right"><button class="btn ghost danger sm" data-act="delrule" data-id="${esc(x.rule_id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No PPE defined yet for this role.</div>'}</section>`).join('')}`;
  $('#ruleForm').onsubmit=e=>{e.preventDefault();run('setRule',$('#rr').value,$('#ri').value,Number($('#rq').value),true)};
}

/* ───────── INVENTORY ───────── */
function viewInventory(){
  const rows=S.data.Inventory,items=X.items;
  $('#view').innerHTML=`<div class="page-head"><div><h1>Inventory</h1><p class="muted">Record deliveries, counts and write-offs as signed adjustments. Every change is logged with a reason.</p></div>${liveBar()}</div>
  <section class="card" id="adj"><h2>Adjust stock</h2><form class="row" id="stockForm"><label>PPE item<select id="si">${items.map(i=>`<option value="${esc(i.item_id)}">${esc(label(i.item_id))}</option>`).join('')}</select></label>
  <label style="max-width:170px">Size<select id="ss"></select></label><label style="max-width:130px">Change (+ / −)<input id="sd" type="number" step="1" value="0" required></label><label style="max-width:130px">Alert below<input id="st" type="number" min="0" step="1" value="10" required></label>
  <label>Reason<input id="sr" required minlength="4" placeholder="Delivery / stock count / damaged"></label><button class="btn">Save adjustment</button></form><p class="muted small" id="sNow"></p></section>
  <section class="card"><div class="card-head"><h2 style="margin:0">All stock</h2><input id="stockFind" placeholder="Search item or size…" style="max-width:260px"></div><div id="stockTable"></div></section>`;
  const sizes=()=>rows.filter(r=>r.item_id===$('#si').value).sort(sizeSort);
  const fillSizes=(pick)=>{$('#ss').innerHTML=sizes().map(r=>`<option ${r.size===pick?'selected':''}>${esc(r.size)}</option>`).join('')||'<option value="">— no sizes —</option>';syncNow()};
  const syncNow=()=>{const r=rows.find(x=>x.item_id===$('#si').value&&x.size===$('#ss').value);$('#st').value=r?.low_stock_threshold??10;$('#sNow').textContent=r?`Currently ${num(r.qty_on_hand)} on hand${r.last_updated?' · last updated '+String(r.last_updated).slice(0,16).replace('T',' '):' · never counted'}.`:''};
  $('#si').onchange=()=>fillSizes();$('#ss').onchange=syncNow;fillSizes();
  $('#stockForm').onsubmit=e=>{e.preventDefault();const d=Number($('#sd').value);if(!d&&!confirm('Change is 0 — this only updates the alert level. Continue?'))return;if(!$('#ss').value){toast('This item has no sizes.',true);return}run('adjustStock',$('#si').value,$('#ss').value,d,$('#sr').value,Number($('#st').value))};
  const show=()=>{const q=$('#stockFind').value.toLowerCase();$('#stockTable').innerHTML=table(['PPE','Size','On hand','Alert below','Status','Updated',''],rows.filter(r=>`${label(r.item_id)} ${r.size}`.toLowerCase().includes(q)).map(r=>[esc(label(r.item_id)),esc(r.size),`<b>${num(r.qty_on_hand)}</b>`,r.low_stock_threshold,r.qty_on_hand===0?'<span class="badge bad">Out</span>':r.qty_on_hand<r.low_stock_threshold?'<span class="badge warn">Low</span>':'<span class="badge">OK</span>',esc(String(r.last_updated||'—').slice(0,10)),`<button class="btn ghost sm" data-act="adjust" data-item="${esc(r.item_id)}" data-size="${esc(r.size)}">Adjust</button>`]))};
  $('#stockFind').oninput=show;show();
}

/* ───────── COLLECTIONS (store keeper) ───────── */
function preferredSize(eid,itemId){const l=linesOf(eid).filter(x=>x.item_status==='Collected'&&x.size&&x.item_id===itemId).pop();return l?.size}
function sizeOptions(rows,qty,pref){
  const ok=rows.filter(r=>r.qty_on_hand>=qty);
  if(!ok.length)return '<option value="">Out of stock</option>';
  const auto=ok.length===1?ok[0].size:(ok.some(r=>r.size===pref)?pref:''); // never guess a size: pick only if unambiguous or previously issued
  return `<option value="" ${auto?'':'selected'}>Select size…</option>`+rows.map(r=>`<option value="${esc(r.size)}" ${r.qty_on_hand<qty?'disabled':''} ${r.size===auto?'selected':''}>${esc(r.size)} · ${num(r.qty_on_hand)} available</option>`).join('');
}
function viewCollections(){
  const lines=S.data.Issuance_Log.filter(x=>x.item_status==='Pending'),grouped=lines.reduce((g,x)=>{(g[x.employee_id]??=[]).push(x);return g},{})
  $('#view').innerHTML=`<div class="page-head"><div><h1>Collections</h1><p class="muted">Tick what the person is collecting now and confirm. Out-of-stock items stay pending.</p></div>${liveBar()}</div>
  <label style="margin-bottom:.6rem">Search employee or PPE<input id="issueFind" placeholder="Name, employee ID or PPE item"></label><div id="issueList"></div>`;
  const show=()=>{const q=$('#issueFind').value.toLowerCase();
    $('#issueList').innerHTML=Object.entries(grouped).filter(([id,ls])=>`${emp(id)?.name} ${id} ${ls.map(l=>label(l.item_id)).join(' ')}`.toLowerCase().includes(q)).map(([id,ls])=>{
      const held=holdings(id);
      return `<section class="card"><div class="card-head"><div><h2 style="margin:0">${esc(emp(id)?.name||id)}</h2><span class="muted small">${esc(id)} · ${ls.length} outstanding${held.length?` · already holds ${held.length} PPE type${held.length===1?'':'s'}`:''}</span></div><span class="badge warn">Awaiting collection</span></div>
      <form class="kit-form" data-emp="${esc(id)}">${ls.map(x=>{const pref=preferredSize(id,x.item_id),rows=S.data.Inventory.filter(s=>s.item_id===x.item_id).sort(sizeSort),anyOk=rows.some(s=>s.qty_on_hand>=x.qty);
        return `<div class="line"><label class="check"><input type="checkbox" name="pick" value="${esc(x.line_id)}" ${anyOk?'':'disabled'}><span><b>${esc(label(x.item_id))}</b><br><span class="muted small">${esc(x.batch_type)} · ${num(x.qty)} ${esc(uom(x.item_id))}</span></span></label>
        <label>Size / available<select data-size="${esc(x.line_id)}" ${anyOk?'':'disabled'}>${sizeOptions(rows,x.qty,pref)}</select></label></div>`}).join('')}
      <div class="actions"><button class="btn">Confirm selected collection</button><button type="button" class="btn ghost" data-act="pickall">Select all in stock</button></div></form></section>`}).join('')||'<section class="card empty">Nothing is waiting to be collected.</section>';};
  $('#issueFind').oninput=show;show();
}

/* ───────── REPLACEMENTS ───────── */
function viewReplacements(){
  const d=S.data,admin=isAdmin(),reqs=d.Replacement_Requests;
  $('#view').innerHTML=`<div class="page-head"><div><h1>Replacement requests</h1><p class="muted">Worn, damaged or lost PPE. Admin approval queues a re-issue for the store keeper.</p></div>${liveBar()}</div>
  ${admin?`<section class="card"><h2>Awaiting decision</h2>${reqs.filter(x=>x.status==='Pending').map(r=>`<form class="card decision" data-id="${esc(r.request_id)}"><strong>${esc(emp(r.employee_id)?.name||r.employee_id)}</strong> · ${esc(label(r.item_id))}<p class="muted">${esc(r.reason)}</p><div class="row"><label style="max-width:170px">Approved quantity<input name="qty" type="number" min="1" max="1000" value="1"></label><button type="submit" class="btn" data-decision="yes">Approve</button><button type="submit" class="btn ghost danger" data-decision="no">Reject</button></div></form>`).join('')||'<div class="empty">No pending requests.</div>'}</section>`
  :`<section class="card"><h2>Request replacement</h2><form id="requestForm" class="row"><label>Employee<select id="re">${d.Employees.filter(x=>x.employee_id).map(x=>`<option value="${esc(x.employee_id)}">${esc(x.name)} · ${esc(x.employee_id)}</option>`).join('')}</select></label><label>PPE item<select id="rit">${X.items.map(x=>`<option value="${esc(x.item_id)}">${esc(label(x.item_id))}</option>`).join('')}</select></label><label>Reason<input id="reason" required minlength="5" maxlength="500"></label><button class="btn">Submit request</button></form></section>`}
  <section class="card"><h2>Request history</h2>${table(['Employee','Item','Reason','Status'],reqs.slice().reverse().map(r=>[esc(emp(r.employee_id)?.name||r.employee_id),esc(label(r.item_id)),esc(r.reason),reqBadge(r.status)]))}</section>`;
  if(admin)$$('.decision').forEach(f=>{f.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>f.dataset.choice=b.dataset.decision);f.onsubmit=e=>{e.preventDefault();const yes=f.dataset.choice==='yes';if(confirm(`${yes?'Approve':'Reject'} this replacement?`))run('decideReplacement',f.dataset.id,yes,Number(f.querySelector('[name=qty]').value))}});
  else $('#requestForm').onsubmit=e=>{e.preventDefault();run('requestReplacement',$('#re').value,$('#rit').value,$('#reason').value)};
}

/* ───────── REPORTS / ACTIVITY ───────── */
const logs=mine=>S.data.Issuance_Log.filter(x=>x.item_status==='Collected'&&(!mine||x.issued_by===S.auth.username));
const reportTable=ls=>table(['Date','Employee','Role','Item','Size','Qty','Issued by','Batch'],ls.map(x=>[esc(day(x.date_issued)),esc(emp(x.employee_id)?.name||x.employee_id),esc(emp(x.employee_id)?.role||''),esc(label(x.item_id)),esc(x.size),num(x.qty),esc(x.issued_by),esc(x.batch_type)]));
function viewActivity(){$('#view').innerHTML=`<div class="page-head"><h1>My activity</h1>${liveBar()}</div><section class="card">${reportTable(logs(true).reverse())}</section>`}
function viewReports(){
  const d=S.data;
  $('#view').innerHTML=`<div class="page-head"><div><h1>Issuance reports</h1></div>${liveBar()}</div><section class="card"><div class="row no-print"><label>From<input type="date" id="from"></label><label>To<input type="date" id="to"></label><label>Role<select id="roleFilter"><option value="">All roles</option>${roles().map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label>Item<select id="itemFilter"><option value="">All items</option>${d.Item_Catalog.map(x=>`<option value="${esc(x.item_id)}">${esc(label(x.item_id))}</option>`).join('')}</select></label><button class="btn" id="csv">Export CSV</button><button class="btn ghost" id="print">Print</button></div><div id="report"></div></section>
  <section class="card"><h2>Outstanding approvals</h2>${table(['Employee','Role','Pending items'],d.Employees.filter(e=>linesOf(e.employee_id).some(x=>x.item_status==='Pending')).map(e=>[esc(e.name),esc(e.role),linesOf(e.employee_id).filter(x=>x.item_status==='Pending').length]))}</section>`;
  const filtered=()=>logs(false).filter(x=>(!$('#from').value||day(x.date_issued)>=$('#from').value)&&(!$('#to').value||day(x.date_issued)<=$('#to').value)&&(!$('#roleFilter').value||emp(x.employee_id)?.role===$('#roleFilter').value)&&(!$('#itemFilter').value||x.item_id===$('#itemFilter').value));
  const show=()=>$('#report').innerHTML=reportTable(filtered().reverse());['from','to','roleFilter','itemFilter'].forEach(id=>$('#'+id).onchange=show);$('#print').onclick=()=>window.print();
  $('#csv').onclick=()=>{const f=['date_issued','employee_id','employee_name','role','item_id','item','size','qty','issued_by','batch_type','issuance_id'];const ls=filtered().map(x=>[x.date_issued,x.employee_id,emp(x.employee_id)?.name,emp(x.employee_id)?.role,x.item_id,label(x.item_id),x.size,x.qty,x.issued_by,x.batch_type,x.issuance_id]);
    // leading = + - @ can trigger spreadsheet formulas: neutralise them in exported text
    const safe=z=>{z=String(z??'');return /^[=+\-@]/.test(z)?"'"+z:z};
    const csv=[f,...ls].map(r=>r.map(z=>`"${safe(z).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));a.download='ARAHAS-PPE-issuance.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)};
  show();
}

/* ───────── events (one delegated handler set) ───────── */
const closest=(e,s)=>e.target.closest(s);
document.addEventListener('click',async e=>{
  const tab=closest(e,'[data-tab]');if(tab&&!closest(e,'[data-act]')){S.tab=tab.dataset.tab;render();return}
  const a=closest(e,'[data-act]');if(!a)return;const act=a.dataset.act,iid=a.dataset.iid;
  const A={
    signout:()=>signOut(),refresh:()=>refresh(true),goto:()=>{S.tab=a.dataset.tab;render()},
    filter:()=>{S.dashFilter=a.dataset.f;viewDashboard()},
    closedlg:()=>{S.dlg=null;$('#dlg').close()},
    open:()=>{S.dlg={type:'view',iid};paintDialog()},edit:()=>{S.dlg={type:'edit',iid};paintDialog()},
    delemp:()=>confirm('Delete this employee and any pending items? This cannot be undone.')&&run('deleteEmployee',iid),
    discard:()=>confirm('Discard this employee record? This cannot be undone.')&&run('deleteEmployee',iid),
    rmdraft:()=>run('removeDraftItem',iid,a.dataset.item),
    adddraft:()=>{const c=a.closest('.card'),item=$('[data-add-item]',c).value,q=Number($('[data-add-qty]',c).value);if(!item)return;run('setDraftItem',iid,item,q)},
    resetkit:()=>confirm('Replace this kit with the role\'s standard kit? Your edits to this kit will be lost.')&&run('resetDraft',iid),
    approve:()=>{const p=X.empI.get(iid),n=draftsOf(iid).length;if(!n){toast('Add at least one PPE item first.',true);return}if(confirm(`Give final approval for ${p.name} (${p.role}) with ${n} PPE item(s)?`))run('approveEmployee',iid).then(r=>r&&r!==true&&toast(`Approved — ID ${r.employee_id}. Now visible to the store keeper.`))},
    rmline:()=>confirm('Remove this item from the employee\'s approved kit?')&&run('removeIssuanceLine',a.dataset.line),
    undo:()=>{const r=prompt('Why is this collection being undone? (the item goes back into stock)');if(r&&r.trim().length>=4)run('undoCollection',a.dataset.line,r.trim());else if(r!==null)toast('Give a reason of at least 4 characters.',true)},
    addppe:async()=>{const items=$$('[data-pick]:checked').map(c=>({itemId:c.value,qty:Number($(`[data-pickqty="${CSS.escape(c.value)}"]`).value)}));if(!items.length){toast('Tick at least one PPE item.',true);return}
      S.dlg.addOpen=true;await run('addPpeToEmployee',iid,items,$('#addReason').value)},
    delrule:()=>confirm('Delete this rule?')&&run('deleteRule',a.dataset.id),
    adjust:()=>{$('#si').value=a.dataset.item;$('#si').onchange();$('#ss').value=a.dataset.size;$('#ss').onchange();$('#adj').scrollIntoView({behavior:'smooth'});$('#sd').focus()},
    pickall:()=>$$('input[name=pick]:not(:disabled)',a.closest('form')).forEach(c=>c.checked=true)
  };
  if(A[act])A[act]();
});
document.addEventListener('change',e=>{
  const c=closest(e,'[data-change]');if(!c)return;const k=c.dataset.change;
  if(k==='qty')run('setDraftItem',c.dataset.iid,c.dataset.item,Number(c.value));
  if(k==='role'){const p=X.empI.get(c.dataset.iid);if(confirm(`Change role to ${c.value}?\n\nThis REPLACES the current draft kit with the standard ${c.value} kit.`))run('editEmployee',p.internal_id,p.name,c.value);else c.value=p.role}
  if(k==='rulqty')run('setRule',c.dataset.role,c.dataset.item,Number(c.value),c.closest('tr').querySelector('[data-change=rulact]').checked);
  if(k==='rulact')run('setRule',c.dataset.role,c.dataset.item,Number(c.closest('tr').querySelector('[data-change=rulqty]').value),c.checked);
});
document.addEventListener('submit',e=>{
  const f=e.target.closest('.kit-form');if(!f)return;e.preventDefault();
  const sel=$$('input[name=pick]:checked',f).map(i=>({lineId:i.value,size:$(`select[data-size="${CSS.escape(i.value)}"]`,f)?.value}));
  if(!sel.length){toast('Select at least one item.',true);return}if(sel.some(x=>!x.size)){toast('Choose an in-stock size for every selected item.',true);return}
  if(confirm(`Issue ${sel.length} item(s) to ${emp(f.dataset.emp)?.name}?`))run('issueBatch',sel).then(r=>{if(r&&r.skipped?.length)toast(`${r.issued} issued. Out of stock, still pending: ${r.skipped.map(label).join(', ')}.`,true);else if(r&&r.issued)toast(`${r.issued} item(s) issued and stock updated.`)});
});
$('#dlg').addEventListener('close',()=>{S.dlg=null});
loginView();
</script>
</body>
</html>

File name: PPE_System_PRD.md
Language: 
# Product Requirements Document
## QHSE PPE Requisition, Approval & Inventory Management System

**Prepared for:** Caleb (Head, QHSE) — Arahas
**Status:** Draft v1 for review
**Author:** [Your name], Graduate Trainee, QHSE

---

## 1. Background & Problem Statement

PPE requisition, approval, and disbursement is currently tracked using standalone spreadsheets (see `PPE_REQUISITION_-_Phase_2_2026_ARAHAS__GEP.xlsx`) that list item categories, sizes, and stock quantities. There is no consistent system across the department for:

- Approving *who* is entitled to receive PPE
- Recording *what* was actually issued to *whom*, *when*, and in *what size*
- Automatically deducting issued items from stock
- Reporting on issuance trends or flagging low stock

Different staff have built ad hoc versions of this process, so records are inconsistent and hard to audit. With ~100–150 new employees onboarding over the next few months, this gap will get worse without a structured system.

## 2. Goal

Build a simple, two-role web application that:

1. Lets **Caleb (Admin)** approve employees for PPE and manage entitlement rules and stock levels.
2. Lets the **Store Keeper** see who's approved, issue the correct PPE against that approval, record sizes, and have inventory auto-deduct.
3. Keeps a full audit trail of every issuance for reporting.
4. Runs on a backend that is **easy for a non-technical admin to trust and eyeball**, but is structured so it can be migrated to a real database (Postgres/SQL) later with minimal rework.

## 3. Users & Roles

| Role | Who | Can do |
|---|---|---|
| **Admin** | Caleb | Approve/reject employees for PPE issuance; define/edit which PPE items each role is entitled to; add or adjust inventory stock; view reports & low-stock alerts; re-approve annual/replacement issuances |
| **Store Keeper** | Store keeper(s) | View approved-and-pending employees; issue PPE against an approval (select size/qty); look up any existing employee to record a replacement issuance (flagged, pending Caleb's approval if it's a full re-issue); cannot self-approve new entitlements or edit stock levels directly beyond what's deducted by issuance |

Both roles log in with a simple username/password (low-security, internal tool — see §8).

## 4. Core Workflows

### 4.1 Approval workflow (Admin)
1. Caleb adds a new employee: Name, **Role category** (Field Officer / Coordinator / Supervisor / Other).
2. On approval, the system **auto-generates a unique Employee ID** — this is the system of record for identifying that employee going forward (avoids duplicate-name confusion across 100+ staff).
3. Based on role, the system auto-populates the **entitled PPE list** from the current Entitlement Rules table (editable — see 4.3).
4. Caleb clicks **Approve**. Status becomes `Approved — Pending Collection`.
5. This employee + their entitled item list now appears in the Store Keeper's queue.

*Department/site is deferred to Phase 2 (see §9) — not part of MVP data entry, but the Employees table structure in §5.1 reserves the field so it can be turned on later without a schema change.*

### 4.2 Issuance workflow (Store Keeper)
1. Store keeper opens their dashboard and sees a list of employees who are `Approved — Pending Collection` (and can search all employees).
2. Selects an employee → sees their entitled PPE list (e.g., Safety Boots, Coverall, Hard Hat, Gloves...).
3. For each item, selects **size** and confirms issuance (quantity defaults to 1 unless the item's UoM implies otherwise, e.g., "Dozens" for gloves — editable).
4. Clicks **Confirm Collection**. This:
   - Creates an issuance record (employee, item, size, qty, date, store keeper name)
   - Deducts the issued quantity from that item/size's stock level
   - Updates employee status to `Collected` for that batch, with a per-item collected/outstanding breakdown (so partial collection — e.g., raincoat missed — is visible)

### 4.3 Entitlement rules (Admin, editable)
- A table mapping **Role → list of PPE item categories** that role is entitled to by default.
- Caleb can add/remove items per role (e.g., "Supervisors don't get rain boots" or "add ear muffs to Field Officer default kit").
- Changing a rule does **not** retroactively change already-approved employees' lists — only affects new approvals — unless Caleb explicitly re-applies it.

### 4.4 Replacement / re-issuance workflow
Two cases:

- **Missed item from original kit** (e.g., raincoat was out of stock at the time): the employee's status shows `Partially Collected`, and the specific missing item shows as `Pending` against their record. Once that item is back in stock, the store keeper looks up the employee, marks that item `Collected`, and the record closes out (status moves to `Collected`) — **no re-approval needed**, since it's still part of an already-approved batch.
- **Full re-issue / annual refresh / replacement due to wear**: Store keeper flags "Request Replacement" for an employee → creates a **pending request** that appears in Caleb's queue → Caleb approves → item becomes issuable by the store keeper, same as a fresh approval. This keeps replacements auditable and prevents over-issuance without oversight.

### 4.5 Inventory management (Admin)
- Caleb can add new stock (e.g., "+200 Coveralls, size L") — increments stock table.
- Caleb can also manually adjust quantities (correction for miscounts, damaged stock write-off, etc.) — logged as an adjustment, not a silent edit.
- Low-stock threshold configurable per item/size (e.g., alert when < 10 pairs of size 42 boots remain).

### 4.6 Reporting
Admin dashboard includes:
- Issuance summary: by day / week / month / quarter, filterable by role, item, or site
- Outstanding approvals (approved but not yet collected)
- Low-stock alerts (list + optional visual flag on inventory screen)
- Exportable report (CSV / printable view) for sharing with management

## 5. Data Model

Structured so each concept maps to one spreadsheet tab now, and one SQL table later (tab name → table name, 1:1).

### 5.1 `Employees`
| Field | Type | Notes |
|---|---|---|
| employee_id | text (PK) | **system-generated on approval** — unique ID, source of truth for identifying an employee (not relying on name matching) |
| name | text | |
| role | enum | Field Officer / Coordinator / Supervisor / Other |
| department/site | text | reserved for Phase 2 — not used in MVP data entry, kept as an empty column now so no schema change is needed later |
| date_added | date | |
| status | enum | Pending / Approved — Pending Collection / Collected / Partially Collected |
| approved_by | text | Caleb's username (only Admin account for now — see §8.2) |
| approved_date | date | |

### 5.2 `Entitlement_Rules`
| Field | Type | Notes |
|---|---|---|
| role | enum | FK-like link to Employees.role |
| item_category | text | links to Item_Catalog |
| default_qty | number | e.g., 1 pair, 1 dozen |
| active | boolean | allows disabling an item for a role without deleting history |

### 5.3 `Item_Catalog`
Seeded from the **Phase_2_Oct 26** tab of the attached sheet (it's a superset of Phase 1, plus adds the Umbrella line item), so this is the canonical source for the initial catalog:

| Field | Type | Notes |
|---|---|---|
| item_category | text | Safety Boots, Coverall (Single), Coverall (2-Piece), Hard Hats, Impact Gloves, Cotton Gloves, Ear Plugs, Ear Muffs, Safety Goggles, Rain Boot, Rain Coat, Umbrella, etc. |
| item_description | text | brand/type/standard, e.g. "Safety Boot – Low/Ankle – Safety Joggers – BS EN ISO 20345" |
| size_type | enum | Shoe size (38–50) / Letter size (M–XXXXL) / One size |
| uom | text | Pairs / Pieces / Dozens |

### 5.4 `Inventory`
| Field | Type | Notes |
|---|---|---|
| item_category | text | |
| size | text | |
| qty_on_hand | number | |
| low_stock_threshold | number | admin-configurable |
| last_updated | datetime | |

### 5.5 `Issuance_Log`
| Field | Type | Notes |
|---|---|---|
| issuance_id | text (PK) | auto |
| employee_id | text | FK |
| item_category | text | FK |
| size | text | |
| qty | number | |
| date_issued | datetime | left blank/null while item status is `Pending` (not yet collected) |
| item_status | enum | Pending / Collected — tracked per line item so a partially collected batch is visible at the item level, not just the employee level |
| issued_by | text | store keeper username |
| batch_type | enum | Initial / Replacement — Missed Item / Replacement — Approved Reissue |
| related_approval_id | text | links replacement to original or reissue approval |

### 5.6 `Replacement_Requests`
| Field | Type | Notes |
|---|---|---|
| request_id | text (PK) | |
| employee_id | text | |
| item_category | text | |
| reason | text | free text, e.g. "annual refresh" / "worn out" |
| requested_by | text | store keeper |
| status | enum | Pending / Approved / Rejected |
| approved_by | text | Caleb |
| approved_date | date | |

### 5.7 `Users`
| Field | Type | Notes |
|---|---|---|
| username | text | |
| password_hash | text | |
| role | enum | Admin / Store Keeper — **one Admin account (Caleb) for MVP**; table structure allows adding a second Admin later without rework if he wants to delegate |

## 6. Screens (MVP)

**Admin (Caleb):**
1. Dashboard — pending approvals count, low-stock alerts, quick stats
2. Employee approvals — add employee, view/edit entitlement, approve
3. Entitlement rules editor — role → item list
4. Inventory — view stock, add stock, adjust stock, set thresholds
5. Reports — issuance history, filters, export
6. Replacement requests queue — approve/reject

**Store Keeper:**
1. Pending collections queue — list of approved employees awaiting issuance
2. Issue PPE screen — select employee → entitled items → size/qty → confirm
3. Employee lookup — search any employee, see full issuance history, flag replacement request
4. My activity log — what I've issued (self-audit)

## 7. Reporting & Alerts (detail)

- **Low stock alert**: triggered per item+size when `qty_on_hand < low_stock_threshold`. Shown as a banner/list on Admin dashboard. (Email/SMS alerts are a possible v2 — not MVP, see §9.)
- **Issuance reports**: filter by date range, role, department, item category. Output as a table on screen + CSV export.
- **Outstanding approvals report**: employees approved but with items not yet collected — helps Caleb chase up store keeper follow-through.

## 8. Technical Approach

### 8.1 Data backend: Google Sheets (recommended)
Given the priorities — Caleb is not technical, must be low-stress to build, must hand over easily by end of week, and must migrate cleanly to Postgres later — **Google Sheets as the live backend**, accessed via the Google Sheets API from a lightweight web app, is the best fit:

- Caleb can open the same spreadsheet directly and *see* the data in a format he already trusts, without needing the app.
- Each tab maps 1:1 to a future SQL table (§5), so migration later is a straightforward CSV import into Postgres — no schema redesign.
- No database server to host, back up, or maintain.
- Google's built-in version history acts as a free audit trail/backup.

**Trade-off to flag:** Sheets isn't built for concurrent-write safety at scale. With 1–2 store keepers and one admin, this is a non-issue. If usage grows significantly (many simultaneous store keepers), that's the trigger to migrate to Postgres.

*Alternative considered:* Airtable — nicer UI/forms out of the box, same migration story, but adds a paid-tier dependency and another login for Caleb to manage. Google Sheets wins on "already trusted, already free, already familiar."

### 8.2 App layer
A single small web app (e.g., Next.js or a simple Flask/Node app) with:
- Two role-gated views (Admin / Store Keeper) behind simple username+password auth (a small `Users` tab/table, hashed passwords — no need for OAuth or third-party auth providers)
- Reads/writes to Google Sheets via API for all the tables in §5
- Business logic (entitlement lookup, stock deduction, status updates) lives in the app, not in spreadsheet formulas — keeps the sheet simple and safe for Caleb to view without breaking formulas

### 8.3 Hosting
A lightweight free/low-cost hosting option (e.g., Vercel, Render) is sufficient given expected usage (a few internal users). No dedicated server needed for MVP.

## 9. Phased Build Plan

**Phase 1 — MVP (target: end of week)**
- Employee approval flow (Admin)
- Entitlement rules (editable, default seeded from current PPE categories)
- Issuance flow (Store Keeper), with stock auto-deduction
- Basic inventory add/adjust
- Simple login (Admin/Store Keeper)
- Basic issuance report (on-screen table + CSV export)

**Phase 2 — near-term follow-up**
- Replacement request workflow (approval queue)
- Low-stock alert banner on dashboard
- Outstanding-approvals report
- Filters on reporting (role, date range, department)

**Phase 3 — future / scale-up**
- Email or SMS low-stock alerts
- Migration to Postgres if usage/concurrency grows
- Employee self-service (view their own issuance history)
- Barcode/QR-based issuance for faster store keeper workflow

## 10. Confirmed Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | Employee identification | System auto-generates a unique Employee ID on approval — the source of truth for identifying staff, not name matching |
| 2 | Partially collected handling | Tracked at the **item level** within a batch (`Pending` / `Collected` per line item), not just at the employee level. Employee status shows `Partially Collected` until all items in the batch are closed out; store keeper closes out individual items as stock becomes available and the employee returns to collect |
| 3 | Admin access | One Admin account (Caleb) for MVP. Data model supports adding a second Admin later without rework |
| 4 | Department/site tracking | Deferred to Phase 2. Field reserved in `Employees` table now so no schema change needed when it's switched on |
| 5 | Item Catalog source | Seeded from the **Phase_2_Oct 26** tab (superset of Phase 1 + Umbrella) |

---

*Next step: move to detailed screen wireframes / build.*

---

## 11. Addendum v1.1 — Corrections & Reversibility (added after v2 build)

The v1 build exposed a real gap: an operational system needs to let people **fix mistakes**, not just move forward. The following rules are now part of the spec, implemented in `api/rpc.js`:

| Situation | Rule |
|---|---|
| Employee record added by mistake, still `Pending` | Admin can **discard** it outright — no trace kept, since nothing was ever approved or issued. |
| Employee approved, but nothing collected yet | Admin can still **delete** the employee record (removes their pending issuance lines too). |
| Employee has at least one `Collected` item | **Cannot** be deleted — that's real stock history. Admin must **Undo** the specific collected item(s) first if they were wrong, then delete becomes possible once nothing remains collected. |
| An approved item hasn't been collected yet | Admin can **remove** just that line from the employee's kit — no stock impact, since nothing was ever deducted. |
| An item was collected in error | Admin can **undo** the collection: the quantity returns to Inventory, the line reopens as `Pending`, and a mandatory reason is written to `Stock_Movements` for audit. |
| Entitlement rule no longer wanted | Admin can either deactivate it (kept for history, stops being offered) or **delete** it outright. |
| Stock count is wrong (damage, miscount, write-off) | There is deliberately **no blind "reset" button** — corrections are made as a signed adjustment (+/-) with a required reason, so every change to stock is explained and logged, never silent. |

This keeps the system flexible for day-to-day human error while preserving §5's core promise: once something is genuinely issued and collected, it becomes accountable history rather than something that can quietly disappear.
