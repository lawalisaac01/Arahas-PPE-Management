const crypto = require('crypto');
const { readSnapshot, writeTable, writeTables } = require('../lib/sheets');
const { issueToken, verify, checkPassword } = require('../lib/auth');
const { ROLES } = require('../lib/catalog');

const uid = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

function requireRole(session, ...roles) {
  if (!roles.includes(session.role)) throw new Error(`Only ${roles.join(' or ')} can do this.`);
}

function nextEmployeeId(employees) {
  const year = new Date().getFullYear();
  const used = employees.filter(e => e.employee_id).length;
  return `ARH-${year}-${String(used + 1).padStart(4, '0')}`;
}

// ---- individual RPCs — each returns { result, tables? } where `tables`
// lists which snapshot tables changed, so the caller can re-read once. ----

async function signIn(args) {
  const [username, password] = args;
  if (!username || !password) throw new Error('Username and password are required.');
  const snap = await readSnapshot();
  const user = snap.Users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !(await checkPassword(password, user.password_hash))) throw new Error('Incorrect username or password.');
  const token = issueToken(user);
  return { result: { token, username: user.username, role: user.role, display_name: user.display_name }, snap };
}

async function signOut() {
  return { result: { ok: true } };
}

async function addEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [name, role] = args;
  if (!name || name.trim().length < 3) throw new Error('Enter the employee\'s full name.');
  if (!ROLES.includes(role)) throw new Error('Unrecognised role.');
  snap.Employees.push({
    internal_id: uid('emp'), employee_id: '', name: name.trim(), role,
    department_site: '', date_added: today(), status: 'Pending', approved_by: '', approved_date: ''
  });
  await writeTable('Employees', snap.Employees);
  return { result: { ok: true } };
}

async function editEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, name, role] = args;
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  if (!name || name.trim().length < 3) throw new Error('Enter the employee\'s full name.');
  emp.name = name.trim();
  if (emp.status === 'Pending') {
    if (!ROLES.includes(role)) throw new Error('Unrecognised role.');
    emp.role = role;
  }
  await writeTable('Employees', snap.Employees);
  return { result: { ok: true } };
}

async function approveEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId, itemIds] = args;
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  if (emp.status !== 'Pending') throw new Error('This employee has already been approved.');
  if (!Array.isArray(itemIds) || !itemIds.length) throw new Error('Select at least one PPE item to approve.');

  emp.employee_id = nextEmployeeId(snap.Employees);
  emp.status = 'Approved — Pending Collection';
  emp.approved_by = session.username;
  emp.approved_date = today();

  const approvalId = uid('appr');
  itemIds.forEach(itemId => {
    const rule = snap.Entitlement_Rules.find(r => r.role === emp.role && r.item_id === itemId && String(r.active) === 'true');
    const qty = rule ? Number(rule.default_qty) || 1 : 1;
    snap.Issuance_Log.push({
      line_id: uid('ln'), issuance_id: approvalId, employee_id: emp.employee_id, item_id: itemId,
      size: '', qty, date_issued: '', item_status: 'Pending', issued_by: '', batch_type: 'Initial', related_approval_id: approvalId
    });
  });

  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true, employee_id: emp.employee_id } };
}

async function setRule(session, args, snap) {
  requireRole(session, 'Admin');
  const [role, itemId, qty, active] = args;
  if (!ROLES.includes(role)) throw new Error('Unrecognised role.');
  if (!(qty > 0)) throw new Error('Quantity must be at least 1.');
  let rule = snap.Entitlement_Rules.find(r => r.role === role && r.item_id === itemId);
  if (rule) { rule.default_qty = qty; rule.active = !!active; }
  else snap.Entitlement_Rules.push({ rule_id: uid('rule'), role, item_id: itemId, default_qty: qty, active: !!active });
  await writeTable('Entitlement_Rules', snap.Entitlement_Rules);
  return { result: { ok: true } };
}

async function adjustStock(session, args, snap) {
  requireRole(session, 'Admin');
  const [itemId, size, delta, reason, threshold] = args;
  if (!reason || reason.trim().length < 4) throw new Error('Describe the reason for this adjustment.');
  let row = snap.Inventory.find(r => r.item_id === itemId && r.size === size);
  if (!row) { row = { item_id: itemId, size, qty_on_hand: 0, low_stock_threshold: threshold ?? 10, last_updated: '' }; snap.Inventory.push(row); }
  const newQty = Number(row.qty_on_hand || 0) + Number(delta || 0);
  if (newQty < 0) throw new Error('This would take stock below zero.');
  row.qty_on_hand = newQty;
  if (threshold !== undefined && threshold !== null) row.low_stock_threshold = threshold;
  row.last_updated = now();
  snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: itemId, size, delta, reason: reason.trim(), actor: session.username, timestamp: now() });
  await writeTables({ Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements });
  return { result: { ok: true } };
}

async function issueBatch(session, args, snap) {
  requireRole(session, 'Admin', 'Store Keeper');
  const [selected] = args; // [{lineId, size}]
  if (!Array.isArray(selected) || !selected.length) throw new Error('Select at least one item to issue.');

  const skipped = [];
  selected.forEach(({ lineId, size }) => {
    const line = snap.Issuance_Log.find(l => l.line_id === lineId);
    if (!line || line.item_status !== 'Pending') return;
    const stock = snap.Inventory.find(r => r.item_id === line.item_id && r.size === size);
    const have = stock ? Number(stock.qty_on_hand) : 0;
    if (!stock || have < Number(line.qty)) { skipped.push(line.item_id); return; }
    stock.qty_on_hand = have - Number(line.qty);
    stock.last_updated = now();
    line.size = size;
    line.item_status = 'Collected';
    line.date_issued = now();
    line.issued_by = session.username;
    snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: line.item_id, size, delta: -Number(line.qty), reason: 'Issuance to ' + line.employee_id, actor: session.username, timestamp: now() });
  });

  // recompute each affected employee's status
  const employeeIds = [...new Set(selected.map(s => snap.Issuance_Log.find(l => l.line_id === s.lineId)?.employee_id).filter(Boolean))];
  employeeIds.forEach(empId => {
    const lines = snap.Issuance_Log.filter(l => l.employee_id === empId);
    const emp = snap.Employees.find(e => e.employee_id === empId);
    if (!emp) return;
    const pending = lines.filter(l => l.item_status === 'Pending').length;
    const collected = lines.filter(l => l.item_status === 'Collected').length;
    emp.status = pending === 0 ? 'Collected' : (collected > 0 ? 'Partially Collected' : emp.status);
  });

  await writeTables({ Issuance_Log: snap.Issuance_Log, Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements, Employees: snap.Employees });
  if (skipped.length) throw new Error('Saved, but out of stock for: ' + skipped.join(', ') + '. Those items stay pending.');
  return { result: { ok: true } };
}

async function requestReplacement(session, args, snap) {
  requireRole(session, 'Admin', 'Store Keeper');
  const [employeeId, itemId, reason] = args;
  if (!snap.Employees.some(e => e.employee_id === employeeId)) throw new Error('Employee not found.');
  if (!reason || reason.trim().length < 5) throw new Error('Give a reason for the replacement.');
  snap.Replacement_Requests.push({
    request_id: uid('rr'), employee_id: employeeId, item_id: itemId, reason: reason.trim(),
    requested_by: session.username, status: 'Pending', approved_by: '', approved_date: ''
  });
  await writeTable('Replacement_Requests', snap.Replacement_Requests);
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
      size: '', qty: qty || 1, date_issued: '', item_status: 'Pending', issued_by: '',
      batch_type: 'Replacement — Approved Reissue', related_approval_id: req.request_id
    });
    const emp = snap.Employees.find(e => e.employee_id === req.employee_id);
    if (emp && emp.status === 'Collected') emp.status = 'Partially Collected';
    await writeTables({ Replacement_Requests: snap.Replacement_Requests, Issuance_Log: snap.Issuance_Log, Employees: snap.Employees });
  } else {
    await writeTable('Replacement_Requests', snap.Replacement_Requests);
  }
  return { result: { ok: true } };
}

async function deleteEmployee(session, args, snap) {
  requireRole(session, 'Admin');
  const [internalId] = args;
  const emp = snap.Employees.find(e => e.internal_id === internalId);
  if (!emp) throw new Error('Employee not found.');
  const hasCollected = snap.Issuance_Log.some(l => l.employee_id && l.employee_id === emp.employee_id && l.item_status === 'Collected');
  if (hasCollected) throw new Error('This employee already has items marked Collected — that\'s real stock history and can\'t be deleted. Use "Undo" on the specific collected item first if it was a mistake.');
  snap.Employees = snap.Employees.filter(e => e.internal_id !== internalId);
  if (emp.employee_id) snap.Issuance_Log = snap.Issuance_Log.filter(l => l.employee_id !== emp.employee_id);
  await writeTables({ Employees: snap.Employees, Issuance_Log: snap.Issuance_Log });
  return { result: { ok: true } };
}

async function removeIssuanceLine(session, args, snap) {
  requireRole(session, 'Admin');
  const [lineId] = args;
  const line = snap.Issuance_Log.find(l => l.line_id === lineId);
  if (!line) throw new Error('Line not found.');
  if (line.item_status !== 'Pending') throw new Error('Only a not-yet-collected item can be removed. Use "Undo" for a collected one.');
  const empId = line.employee_id;
  snap.Issuance_Log = snap.Issuance_Log.filter(l => l.line_id !== lineId);
  const remaining = snap.Issuance_Log.filter(l => l.employee_id === empId);
  const emp = snap.Employees.find(e => e.employee_id === empId);
  if (emp && remaining.length && remaining.every(l => l.item_status === 'Collected')) emp.status = 'Collected';
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
  if (stock) stock.qty_on_hand = Number(stock.qty_on_hand || 0) + Number(line.qty);
  else snap.Inventory.push({ item_id: line.item_id, size: line.size, qty_on_hand: Number(line.qty), low_stock_threshold: 10, last_updated: now() });
  snap.Stock_Movements.push({ movement_id: uid('mv'), item_id: line.item_id, size: line.size, delta: Number(line.qty), reason: 'Undo collection: ' + reason.trim(), actor: session.username, timestamp: now() });
  line.item_status = 'Pending';
  line.date_issued = '';
  line.issued_by = '';
  const emp = snap.Employees.find(e => e.employee_id === line.employee_id);
  if (emp) emp.status = 'Partially Collected';
  await writeTables({ Issuance_Log: snap.Issuance_Log, Inventory: snap.Inventory, Stock_Movements: snap.Stock_Movements, Employees: snap.Employees });
  return { result: { ok: true } };
}

async function deleteRule(session, args, snap) {
  requireRole(session, 'Admin');
  const [ruleId] = args;
  snap.Entitlement_Rules = snap.Entitlement_Rules.filter(r => r.rule_id !== ruleId);
  await writeTable('Entitlement_Rules', snap.Entitlement_Rules);
  return { result: { ok: true } };
}

const HANDLERS = {
  addEmployee, editEmployee, approveEmployee, setRule, adjustStock,
  issueBatch, requestReplacement, decideReplacement,
  deleteEmployee, removeIssuanceLine, undoCollection, deleteRule
};

module.exports = async (req, res) => {
  const started = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only.' }); return; }

  try {
    const { fn, args = [] } = req.body || {};
    if (!fn) throw new Error('Missing fn.');

    if (fn === 'signIn') {
      const { result, snap } = await signIn(args);
      res.status(200).json({ ok: true, result, snapshot: snap, serverMs: Date.now() - started });
      return;
    }
    if (fn === 'signOut') {
      const { result } = await signOut();
      res.status(200).json({ ok: true, result, serverMs: Date.now() - started });
      return;
    }

    // every other fn is (token, ...rest)
    const [token, ...rest] = args;
    const session = verify(token);

    if (fn === 'snapshot') {
      const snap = await readSnapshot();
      res.status(200).json({ ok: true, result: snap, snapshot: snap, serverMs: Date.now() - started });
      return;
    }

    const handler = HANDLERS[fn];
    if (!handler) throw new Error('Unknown function: ' + fn);

    const snap = await readSnapshot();
    const { result } = await handler(session, rest, snap);
    // re-read is unnecessary — `snap` was mutated in place by the handler
    res.status(200).json({ ok: true, result, snapshot: snap, serverMs: Date.now() - started });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message || 'Something went wrong.' });
  }
};
