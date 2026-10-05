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
