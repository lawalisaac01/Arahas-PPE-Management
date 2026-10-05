const crypto = require('crypto');
const { readSnapshot, writeTables } = require('../lib/sheets');
const { issueToken, verify, checkPassword } = require('../lib/auth');
const { notifyRole } = require('../lib/push');

const uid = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

const ST = { PENDING_APPROVAL: 'Pending', AWAITING: 'Approved — Pending Collection', PARTIAL: 'Partially Collected', DONE: 'Collected' };

function requireRole(session, ...roles) {
  if (!roles.includes(session.role)) throw new Error(`Only ${roles.join(' or ')} can do this.`);
}

// ---------- validation helpers ----------
function cleanRole(role) {
  const r = String(role || '').replace(/\s+/g, ' ').trim();
  if (r.length < 2 || r.length > 40) throw new Error('Role must be 2–40 characters.');
  return r;
}
function cleanQty(q) {
  const n = Number(q);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('Quantity must be a whole number from 1 to 1000.');
  return n;
}
function activeItem(snap, itemId) {
  const it = snap.Item_Catalog.find(i => i.item_id === itemId && i.active);
  if (!it) throw new Error('That PPE item is not in the active catalogue.');
  return it;
}
function findPending(snap, internalId) {
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  if (emp.status !== ST.PENDING_APPROVAL) throw new Error('This employee is already approved — the kit can no longer be edited here. Use "Add PPE" on the employee instead.');
  return emp;
}

// Employee IDs never repeat, even after deletions: next = highest existing number this year + 1.
function nextEmployeeId(employees) {
  const year = new Date().getFullYear();
  const re = new RegExp(`^ARH-${year}-(\\d+)$`);
  const max = employees.reduce((m, e) => { const x = re.exec(e.employee_id || ''); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `ARH-${year}-${String(max + 1).padStart(4, '0')}`;
}

// Draft kit lines are Issuance_Log rows with item_status 'Draft', keyed by the
// employee's internal_id (there is no employee_id until approval). No schema change.
const draftLines = (snap, internalId) => snap.Issuance_Log.filter(l => l.item_status === 'Draft' && l.employee_id === internalId);

/** THE ROLE CHECK: replace this person's draft kit with the standard kit for their role. */
function draftFromRules(snap, emp) {
  snap.Issuance_Log = snap.Issuance_Log.filter(l => !(l.item_status === 'Draft' && l.employee_id === emp.internal_id));
  const rules = snap.Entitlement_Rules.filter(r => r.role === emp.role && r.active && snap.Item_Catalog.some(i => i.item_id === r.item_id && i.active));
  rules.forEach(r => snap.Issuance_Log.push({
    line_id: uid('ln'), issuance_id: '', employee_id: emp.internal_id, item_id: r.item_id, size: '',
    qty: Number(r.default_qty) || 1, date_issued: '', item_status: 'Draft', issued_by: '', batch_type: 'Initial', related_approval_id: ''
  }));
  return rules.length;
}

/** Derive an approved employee's status from their real (non-draft) lines. */
function refreshStatus(snap, employeeId) {
  const emp = snap.Employees.find(e => e.employee_id === employeeId);
  if (!emp || emp.status === ST.PENDING_APPROVAL) return;
  const lines = snap.Issuance_Log.filter(l => l.employee_id === employeeId && l.item_status !== 'Draft');
  if (!lines.length) return;
  const pending = lines.filter(l => l.item_status === 'Pending').length;
  const collected = lines.filter(l => l.item_status === 'Collected').length;
  emp.status = pending === 0 ? ST.DONE : collected > 0 ? ST.PARTIAL : ST.AWAITING;
}

// The Users table (password hashes) and push subscriptions never leave the server.
const publicSnapshot = ({ Users, Push_Subscriptions, ...rest }) => rest;

// ---------- RPCs: each returns { result } and mutates `snap` in place ----------
async function signIn(args) {
  const [username, password] = args;
  if (!username || !password) throw new Error('Username and password are required.');
  const snap = await readSnapshot();
  const user = snap.Users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !(await checkPassword(password, user.password_hash))) throw new Error('Incorrect username or password.');
  const token = issueToken(user);
  return { result: { token, username: user.username, role: user.role, display_name: user.display_name }, snap };
}

async function addEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [name, roleIn] = args;
  if (!name || name.trim().length < 3) throw new Error('Enter the employee\'s full name.');
  const role = cleanRole(roleIn);
  const emp = {
    internal_id: uid('emp'), employee_id: '', name: name.trim().replace(/\s+/g, ' '), role,
    department_site: '', date_added: today(), status: ST.PENDING_APPROVAL, approved_by: '', approved_date: ''
  };
  snap.Employees.push(emp);
  const drafted = draftFromRules(snap, emp);
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true, drafted, internal_id: emp.internal_id } };
}

async function editEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, name, roleIn] = args;
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  if (!name || name.trim().length < 3) throw new Error('Enter the employee\'s full name.');
  emp.name = name.trim().replace(/\s+/g, ' ');
  let drafted;
  if (emp.status === ST.PENDING_APPROVAL && roleIn && cleanRole(roleIn) !== emp.role) {
    emp.role = cleanRole(roleIn);
    drafted = draftFromRules(snap, emp); // new role => the kit is replaced with that role's standard kit
  }
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true, drafted } };
}

async function resetDraft(session, args, snap) {
  requireRole(session, 'Admin');
  const emp = findPending(snap, args[0]);
  const drafted = draftFromRules(snap, emp);
  await writeTables({ Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true, drafted } };
}

async function setDraftItem(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, itemId, qtyIn] = args;
  const emp = findPending(snap, internalId);
  activeItem(snap, itemId);
  const qty = cleanQty(qtyIn);
  const line = draftLines(snap, emp.internal_id).find(l => l.item_id === itemId);
  if (line) line.qty = qty;
  else snap.Issuance_Log.push({
    line_id: uid('ln'), issuance_id: '', employee_id: emp.internal_id, item_id: itemId, size: '', qty,
    date_issued: '', item_status: 'Draft', issued_by: '', batch_type: 'Initial', related_approval_id: ''
  });
  await writeTables({ Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true } };
}

async function removeDraftItem(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, itemId] = args;
  const emp = findPending(snap, internalId);
  snap.Issuance_Log = snap.Issuance_Log.filter(l => !(l.item_status === 'Draft' && l.employee_id === emp.internal_id && l.item_id === itemId));
  await writeTables({ Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true } };
}

/** Final approval: the (possibly edited) draft kit becomes real pending lines. */
async function approveEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const emp = findPending(snap, args[0]);
  const drafts = draftLines(snap, emp.internal_id);
  if (!drafts.length) throw new Error('This kit is empty. Add at least one PPE item (or reset to the role standard) before approving.');
  drafts.forEach(d => activeItem(snap, d.item_id));

  emp.employee_id = nextEmployeeId(snap.Employees);
  emp.status = ST.AWAITING;
  emp.approved_by = session.username;
  emp.approved_date = today();

  const approvalId = uid('appr');
  drafts.forEach(d => {
    d.employee_id = emp.employee_id; d.item_status = 'Pending';
    d.issuance_id = approvalId; d.related_approval_id = approvalId;
  });
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  await pushAndPersist(snap, 'Store Keeper', {
    title: 'PPE ready to issue',
    body: `${emp.name} (${emp.employee_id}) was approved for ${drafts.length} item${drafts.length === 1 ? '' : 's'} — ready for collection.`,
    tag: 'ppe-collection', url: '/'
  });
  return { result: { ok: true, employee_id: emp.employee_id, items: drafts.length } };
}

/** Give an already-approved employee more PPE. They can hold any number of items. */
async function addPpeToEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, items, reason] = args;
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  if (emp.status === ST.PENDING_APPROVAL) throw new Error('Approve this employee first — until then, edit the draft kit instead.');
  if (!Array.isArray(items) || !items.length) throw new Error('Choose at least one PPE item.');
  const approvalId = uid('appr');
  items.forEach(({ itemId, qty }) => {
    activeItem(snap, itemId);
    snap.Issuance_Log.push({
      line_id: uid('ln'), issuance_id: approvalId, employee_id: emp.employee_id, item_id: itemId, size: '',
      qty: cleanQty(qty), date_issued: '', item_status: 'Pending', issued_by: '',
      batch_type: 'Additional' + (reason && String(reason).trim() ? ' — ' + String(reason).trim().slice(0, 80) : ''),
      related_approval_id: approvalId
    });
  });
  refreshStatus(snap, emp.employee_id);
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true, added: items.length } };
}

async function setRule(session, args, snap) {
  requireRole(session, 'Admin');
  const [roleIn, itemId, qtyIn, active] = args;
  const role = cleanRole(roleIn);
  activeItem(snap, itemId);
  const qty = cleanQty(qtyIn);
  const rule = snap.Entitlement_Rules.find(r => r.role === role && r.item_id === itemId);
  if (rule) { rule.default_qty = qty; rule.active = !!active; }
  else snap.Entitlement_Rules.push({ rule_id: uid('rule'), role, item_id: itemId, default_qty: qty, active: !!active });
  await writeTables({ Entitlement_Rules: snap.Entitlement_Rules });
  return { result: { ok: true } };
}

async function deleteRule(session, args, snap) {
  requireRole(session, 'Admin');
  snap.Entitlement_Rules = snap.Entitlement_Rules.filter(r => r.rule_id !== args[0]);
  await writeTables({ Entitlement_Rules: snap.Entitlement_Rules });
  return { result: { ok: true } };
}

async function adjustStock(session, args, snap) {
  requireRole(session, 'Admin');
  const [itemId, size, deltaIn, reason, threshold] = args;
  if (!reason || reason.trim().length < 4) throw new Error('Describe the reason for this adjustment.');
  activeItem(snap, itemId);
  const delta = Number(deltaIn);
  if (!Number.isInteger(delta)) throw new Error('The change must be a whole number.');
  let row = snap.Inventory.find(r => r.item_id === itemId && r.size === String(size));
  if (!row) { row = { item_id: itemId, size: String(size), qty_on_hand: 0, low_stock_threshold: threshold ?? 10, last_updated: '' }; snap.Inventory.push(row); }
  const newQty = Number(row.qty_on_hand || 0) + delta;
  if (newQty < 0) throw new Error('This would take stock below zero.');
  row.qty_on_hand = newQty;
  if (threshold !== undefined && threshold !== null && Number(threshold) >= 0) row.low_stock_threshold = Number(threshold);
  row.last_updated = now();
  snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: itemId, size: String(size), delta, reason: reason.trim(), actor: session.username, timestamp: now() });
  await writeTables({ Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements });
  return { result: { ok: true } };
}

async function issueBatch(session, args, snap) {
  requireRole(session, 'Admin', 'Store Keeper');
  const [selected] = args; // [{lineId, size}]
  if (!Array.isArray(selected) || !selected.length) throw new Error('Select at least one item to issue.');

  const skipped = [];
  const touched = new Set();
  let touchedLines = 0;
  selected.forEach(({ lineId, size }) => {
    const line = snap.Issuance_Log.find(l => l.line_id === lineId);
    if (!line || line.item_status !== 'Pending') return;
    const stock = snap.Inventory.find(r => r.item_id === line.item_id && r.size === String(size));
    const have = stock ? Number(stock.qty_on_hand) : 0;
    if (!stock || have < Number(line.qty)) { skipped.push(line.item_id); return; }
    stock.qty_on_hand = have - Number(line.qty);
    stock.last_updated = now();
    line.size = String(size);
    line.item_status = 'Collected';
    line.date_issued = now();
    line.issued_by = session.username;
    touched.add(line.employee_id);
    touchedLines++;
    snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: line.item_id, size: String(size), delta: -Number(line.qty), reason: 'Issuance to ' + line.employee_id, actor: session.username, timestamp: now() });
  });
  touched.forEach(id => refreshStatus(snap, id));

  await writeTables({ Issuance_Log: snap.Issuance_Log, Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements, Employees: snap.Employees });
  // Partial success is still success: what could be issued is saved; the rest stays pending and is reported.
  return { result: { ok: true, issued: touchedLines, skipped: [...new Set(skipped)] } };
}

async function requestReplacement(session, args, snap) {
  requireRole(session, 'Admin', 'Store Keeper');
  const [employeeId, itemId, reason] = args;
  if (!snap.Employees.some(e => e.employee_id === employeeId)) throw new Error('Employee not found.');
  activeItem(snap, itemId);
  if (!reason || reason.trim().length < 5) throw new Error('Give a reason for the replacement.');
  snap.Replacement_Requests.push({
    request_id: uid('rr'), employee_id: employeeId, item_id: itemId, reason: reason.trim(),
    requested_by: session.username, status: 'Pending', approved_by: '', approved_date: ''
  });
  await writeTables({ Replacement_Requests: snap.Replacement_Requests });
  const itemName = (snap.Item_Catalog.find(i => i.item_id === itemId) || {}).item_category || itemId;
  await pushAndPersist(snap, 'Admin', {
    title: 'Replacement request',
    body: `${itemName} for ${employeeId} — ${reason.trim()}`,
    tag: 'ppe-replacement-request', url: '/'
  });
  return { result: { ok: true } };
}

async function decideReplacement(session, args, snap) {
  requireRole(session, 'Admin');
  const [requestId, approve, qty] = args;
  const req = snap.Replacement_Requests.find(r => r.request_id === requestId);
  if (!req) throw new Error('Request not found.');
  if (req.status !== 'Pending') throw new Error('This request was already decided.');
  req.status = approve ? 'Approved' : 'Rejected';
  req.approved_by = session.username;
  req.approved_date = today();
  if (approve) {
    const approvalId = uid('appr');
    snap.Issuance_Log.push({
      line_id: uid('ln'), issuance_id: approvalId, employee_id: req.employee_id, item_id: req.item_id,
      size: '', qty: cleanQty(qty || 1), date_issued: '', item_status: 'Pending', issued_by: '',
      batch_type: 'Replacement — Approved Reissue', related_approval_id: req.request_id
    });
    refreshStatus(snap, req.employee_id);
  }
  await writeTables({ Replacement_Requests: snap.Replacement_Requests, Issuance_Log: snap.Issuance_Log, Employees: snap.Employees });
  if (approve) {
    const itemName = (snap.Item_Catalog.find(i => i.item_id === req.item_id) || {}).item_category || req.item_id;
    await pushAndPersist(snap, 'Store Keeper', {
      title: 'Replacement approved',
      body: `${itemName} approved for ${req.employee_id} — ready to issue.`,
      tag: 'ppe-collection', url: '/'
    });
  }
  return { result: { ok: true } };
}

async function deleteEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const emp = snap.Employees.find(e => e.internal_id === args[0]);
  if (!emp) throw new Error('Employee not found.');
  const hasCollected = emp.employee_id && snap.Issuance_Log.some(l => l.employee_id === emp.employee_id && l.item_status === 'Collected');
  if (hasCollected) throw new Error('This employee already has items marked Collected — that\'s real stock history and can\'t be deleted. Use "Undo" on the specific collected item first if it was a mistake.');
  snap.Employees = snap.Employees.filter(e => e.internal_id !== emp.internal_id);
  snap.Issuance_Log = snap.Issuance_Log.filter(l => l.employee_id !== emp.internal_id && (!emp.employee_id || l.employee_id !== emp.employee_id));
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true } };
}

async function removeIssuanceLine(session, args, snap) {
  requireRole(session, 'Admin');
  const line = snap.Issuance_Log.find(l => l.line_id === args[0]);
  if (!line) throw new Error('Line not found.');
  if (line.item_status !== 'Pending') throw new Error('Only a not-yet-collected item can be removed. Use "Undo" for a collected one.');
  snap.Issuance_Log = snap.Issuance_Log.filter(l => l.line_id !== line.line_id);
  refreshStatus(snap, line.employee_id);
  await writeTables({ Issuance_Log: snap.Issuance_Log, Employees: snap.Employees });
  return { result: { ok: true } };
}

async function undoCollection(session, args, snap) {
  requireRole(session, 'Admin');
  const [lineId, reason] = args;
  if (!reason || reason.trim().length < 4) throw new Error('Say why this collection is being undone (audit trail).');
  const line = snap.Issuance_Log.find(l => l.line_id === lineId);
  if (!line) throw new Error('Line not found.');
  if (line.item_status !== 'Collected') throw new Error('This item has not been collected yet.');
  const stock = snap.Inventory.find(r => r.item_id === line.item_id && r.size === line.size);
  if (stock) { stock.qty_on_hand = Number(stock.qty_on_hand || 0) + Number(line.qty); stock.last_updated = now(); }
  else snap.Inventory.push({ item_id: line.item_id, size: line.size, qty_on_hand: Number(line.qty), low_stock_threshold: 10, last_updated: now() });
  snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: line.item_id, size: line.size, delta: Number(line.qty), reason: 'Undo collection: ' + reason.trim(), actor: session.username, timestamp: now() });
  line.item_status = 'Pending'; line.date_issued = ''; line.issued_by = '';
  refreshStatus(snap, line.employee_id);
  await writeTables({ Issuance_Log: snap.Issuance_Log, Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements, Employees: snap.Employees });
  return { result: { ok: true } };
}

// Push a notification to everyone with `role`, and if any dead subscriptions
// got cleaned up in the process, save that. Never throws — a notification
// problem must never fail the approval/request/issuance it's attached to.
async function pushAndPersist(snap, role, payload) {
  try {
    const changed = await notifyRole(snap, role, payload);
    if (changed) await writeTables({ Push_Subscriptions: snap.Push_Subscriptions });
  } catch (e) { /* best-effort — swallow */ }
}

async function savePushSubscription(session, args, snap) {
  const [subJson] = args;
  let sub;
  try { sub = JSON.parse(subJson); } catch { throw new Error('Bad subscription payload.'); }
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Incomplete push subscription.');
  snap.Push_Subscriptions = (snap.Push_Subscriptions || []).filter(s => s.endpoint !== sub.endpoint);
  snap.Push_Subscriptions.push({
    sub_id: uid('push'), username: session.username, role: session.role,
    endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, created_at: now()
  });
  await writeTables({ Push_Subscriptions: snap.Push_Subscriptions });
  return { result: { ok: true } };
}

async function deletePushSubscription(session, args, snap) {
  const [endpoint] = args;
  snap.Push_Subscriptions = (snap.Push_Subscriptions || []).filter(s => s.endpoint !== endpoint);
  await writeTables({ Push_Subscriptions: snap.Push_Subscriptions });
  return { result: { ok: true } };
}

const HANDLERS = {
  addEmployee, editEmployee, resetDraft, setDraftItem, removeDraftItem, approveEmployee, addPpeToEmployee,
  setRule, deleteRule, adjustStock, issueBatch, requestReplacement, decideReplacement,
  deleteEmployee, removeIssuanceLine, undoCollection,
  savePushSubscription, deletePushSubscription
};

async function handle(body) {
  const started = Date.now();
  const { fn, args = [] } = body || {};
  if (!fn) throw new Error('Missing fn.');
  const done = (result, snap) => ({ ok: true, result, snapshot: publicSnapshot(snap), serverMs: Date.now() - started });

  if (fn === 'signIn') { const { result, snap } = await signIn(args); return done(result, snap); }
  if (fn === 'signOut') return { ok: true, result: { ok: true }, serverMs: Date.now() - started };

  const [token, ...rest] = args; // every other fn is (token, ...rest)
  const session = verify(token);
  if (fn === 'snapshot') { const snap = await readSnapshot(); return done(true, snap); }

  const handler = HANDLERS[fn];
  if (!handler) throw new Error('Unknown function: ' + fn);
  const snap = await readSnapshot();
  const { result } = await handler(session, rest, snap);
  return done(result, snap); // handlers mutate `snap` in place, so no re-read is needed
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only.' }); return; }
  try {
    res.status(200).json(await handle(req.body));
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message || 'Something went wrong.' });
  }
};
module.exports.handle = handle; // exported for the offline self-test
