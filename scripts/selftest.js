/**
 * Offline self-test — no Google account needed:  node scripts/selftest.js
 * Runs the real API logic (api/rpc.js) against an in-memory copy of the sheet,
 * seeded from lib/catalog.js. Run it after ANY change to the API.
 */
process.env.SESSION_SECRET = 'test-secret';
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { SCHEMA, CATALOGUE, DEFAULT_RULES } = require('../lib/catalog');

// ---- in-memory stand-in for lib/sheets.js (same typed output as the real reader) ----
const db = {}; Object.keys(SCHEMA).forEach(t => (db[t] = []));
CATALOGUE.forEach(c => {
  db.Item_Catalog.push({ item_id: c.id, item_category: c.category, item_description: c.description, size_type: c.size_type, uom: c.uom, active: true });
  c.sizes.forEach(s => db.Inventory.push({ item_id: c.id, size: s, qty_on_hand: 0, low_stock_threshold: 10, last_updated: '' }));
});
DEFAULT_RULES.forEach(([role, item_id, q], i) => db.Entitlement_Rules.push({ rule_id: 'rule-' + i, role, item_id, default_qty: q, active: true }));
db.Users.push({ username: 'admin', password_hash: 'SECRET-HASH', role: 'Admin', display_name: 'Admin' });
db.Users.push({ username: 'store', password_hash: 'SECRET-HASH', role: 'Store Keeper', display_name: 'Store' });
const clone = (o) => JSON.parse(JSON.stringify(o));
const fake = {
  readSnapshot: async () => clone(db),
  writeTables: async (m) => { Object.entries(m).forEach(([t, rows]) => (db[t] = clone(rows))); },
  writeTable: async (t, rows) => { db[t] = clone(rows); }
};
const realLoad = Module._load;
Module._load = function (req, parent, ...r) {
  if (/lib[\\/]sheets$/.test(req) || req === '../lib/sheets') return fake;
  if (req === 'bcryptjs') return { compare: async () => true, hash: async () => 'x' };
  return realLoad.call(this, req, parent, ...r);
};
const { issueToken } = require('../lib/auth');
const { handle } = require('../api/rpc');
const A = issueToken({ username: 'admin', role: 'Admin', display_name: 'A' });
const S = issueToken({ username: 'store', role: 'Store Keeper', display_name: 'S' });
const call = async (tok, fn, ...a) => handle({ fn, args: [tok, ...a] });
const fails = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('expected failure ' + re); };
const emp = (n) => db.Employees.find(e => e.name === n);
const drafts = (e) => db.Issuance_Log.filter(l => l.item_status === 'Draft' && l.employee_id === e.internal_id);
const stock = (i, s) => db.Inventory.find(r => r.item_id === i && r.size === s);

let n = 0; const test = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  console.log('ARAHAS PPE self-test');

  await test('snapshot never contains the Users table / password hashes', async () => {
    const r = await call(A, 'snapshot');
    assert.ok(!('Users' in r.snapshot)); assert.ok(!JSON.stringify(r).includes('SECRET-HASH'));
  });

  await test('picking a role auto-assigns that role\'s standard PPE as a draft kit', async () => {
    const r = await call(A, 'addEmployee', 'Ada Obi', 'Field Officer');
    assert.strictEqual(r.result.drafted, DEFAULT_RULES.filter(x => x[0] === 'Field Officer').length);
    const ids = drafts(emp('Ada Obi')).map(l => l.item_id).sort();
    assert.deepStrictEqual(ids, DEFAULT_RULES.filter(x => x[0] === 'Field Officer').map(x => x[1]).sort());
    assert.strictEqual(emp('Ada Obi').status, 'Pending');
  });

  await test('a role with no rules yields an empty kit (UI warns; admin can add items)', async () => {
    const r = await call(A, 'addEmployee', 'Bola Ade', 'Drone Pilot');
    assert.strictEqual(r.result.drafted, 0);
  });

  await test('inactive rules are not assigned', async () => {
    await call(A, 'setRule', 'Coordinator', 'umbrella', 1, false);
    await call(A, 'addEmployee', 'Chi Eze', 'Coordinator');
    assert.ok(!drafts(emp('Chi Eze')).some(l => l.item_id === 'umbrella'));
  });

  await test('admin can change qty, add from catalogue, and remove a draft item before approval', async () => {
    const e = emp('Ada Obi');
    await call(A, 'setDraftItem', e.internal_id, 'coverall_single', 3);
    assert.strictEqual(drafts(e).find(l => l.item_id === 'coverall_single').qty, 3);
    await call(A, 'setDraftItem', e.internal_id, 'earmuffs', 1);
    assert.ok(drafts(e).some(l => l.item_id === 'earmuffs'));
    await call(A, 'removeDraftItem', e.internal_id, 'umbrella');
    assert.ok(!drafts(e).some(l => l.item_id === 'umbrella'));
    await fails(call(A, 'setDraftItem', e.internal_id, 'earmuffs', 0), /whole number/);
    await fails(call(A, 'setDraftItem', e.internal_id, 'nope', 1), /catalogue/);
  });

  await test('changing a pending employee\'s role REPLACES the kit with the new role\'s standard', async () => {
    const e = emp('Ada Obi');
    await call(A, 'editEmployee', e.internal_id, 'Ada Obi', 'Supervisor');
    assert.deepStrictEqual(drafts(e).map(l => l.item_id).sort(), DEFAULT_RULES.filter(x => x[0] === 'Supervisor').map(x => x[1]).sort());
    await call(A, 'setDraftItem', e.internal_id, 'earmuffs', 1);
    await call(A, 'resetDraft', e.internal_id); // "Reset to role standard"
    assert.ok(!drafts(e).some(l => l.item_id === 'earmuffs'));
  });

  await test('store keeper cannot edit kits or approve', async () => {
    await fails(call(S, 'setDraftItem', emp('Ada Obi').internal_id, 'earmuffs', 1), /Only Admin/);
    await fails(call(S, 'approveEmployee', emp('Ada Obi').internal_id), /Only Admin/);
  });

  await test('final approval promotes the edited draft into pending lines with a unique ID', async () => {
    const e = emp('Ada Obi'); const before = drafts(e).length;
    const r = await call(A, 'approveEmployee', e.internal_id);
    assert.strictEqual(r.result.items, before);
    assert.strictEqual(emp('Ada Obi').employee_id, 'ARH-' + new Date().getFullYear() + '-0001');
    assert.strictEqual(db.Issuance_Log.filter(l => l.employee_id === emp('Ada Obi').employee_id && l.item_status === 'Pending').length, before);
    assert.strictEqual(drafts(e).length, 0);
    await fails(call(A, 'approveEmployee', e.internal_id), /already approved/);
  });

  await test('approving an empty kit is refused', async () => {
    await fails(call(A, 'approveEmployee', emp('Bola Ade').internal_id), /empty/);
  });

  await test('employee holds MANY PPE: collect some, then admin adds more, then collect again', async () => {
    const e = emp('Ada Obi'), id = e.employee_id;
    const pend = () => db.Issuance_Log.filter(l => l.employee_id === id && l.item_status === 'Pending');
    // stock in
    for (const [i, s] of [['hard_hats', 'One Size'], ['goggles', 'Clear'], ['coverall_2piece', 'XL']]) await call(A, 'adjustStock', i, s, 20, 'opening count', 5);
    const pick = (item, size) => ({ lineId: pend().find(l => l.item_id === item).line_id, size });
    await call(S, 'issueBatch', [pick('hard_hats', 'One Size'), pick('goggles', 'Clear'), pick('coverall_2piece', 'XL')]);
    assert.strictEqual(emp('Ada Obi').status, 'Partially Collected');
    assert.strictEqual(stock('hard_hats', 'One Size').qty_on_hand, 19);
    await call(A, 'addPpeToEmployee', e.internal_id, [{ itemId: 'ear_plugs', qty: 2 }, { itemId: 'earmuffs', qty: 1 }], 'site change');
    assert.ok(pend().some(l => l.item_id === 'earmuffs' && /Additional/.test(l.batch_type)));
    const held = db.Issuance_Log.filter(l => l.employee_id === id && l.item_status === 'Collected');
    assert.strictEqual(held.length, 3);
    await call(A, 'adjustStock', 'earmuffs', 'Hardhat Mounted', 5, 'delivery', 2);
    await call(S, 'issueBatch', [pick('earmuffs', 'Hardhat Mounted')]);
    assert.strictEqual(db.Issuance_Log.filter(l => l.employee_id === id && l.item_status === 'Collected').length, 4);
  });

  await test('cannot add PPE to someone not yet approved', async () => {
    await fails(call(A, 'addPpeToEmployee', emp('Bola Ade').internal_id, [{ itemId: 'earmuffs', qty: 1 }]), /Approve this employee first/);
  });

  await test('adding PPE to a fully-collected employee re-opens their status; undo restores stock', async () => {
    await call(A, 'addEmployee', 'Dee Ike', 'Other'); const d = emp('Dee Ike');
    await call(A, 'approveEmployee', d.internal_id);
    await call(A, 'adjustStock', 'coverall_single', 'L', 5, 'delivery', 2); await call(A, 'adjustStock', 'hard_hats', 'One Size', 1, 'delivery', 2);
    const ln = (item) => db.Issuance_Log.find(l => l.employee_id === emp('Dee Ike').employee_id && l.item_id === item);
    await call(S, 'issueBatch', [{ lineId: ln('coverall_single').line_id, size: 'L' }, { lineId: ln('hard_hats').line_id, size: 'One Size' }]);
    assert.strictEqual(emp('Dee Ike').status, 'Collected');
    await call(A, 'addPpeToEmployee', d.internal_id, [{ itemId: 'umbrella', qty: 1 }]);
    assert.strictEqual(emp('Dee Ike').status, 'Partially Collected');
    const before = stock('coverall_single', 'L').qty_on_hand;
    await call(A, 'undoCollection', ln('coverall_single').line_id, 'wrong size');
    assert.strictEqual(stock('coverall_single', 'L').qty_on_hand, before + 1);
  });

  await test('undo of the only collected item returns status to "Approved — Pending Collection"', async () => {
    await call(A, 'addEmployee', 'Eze Uba', 'Other'); const x = emp('Eze Uba');
    await call(A, 'approveEmployee', x.internal_id);
    await call(A, 'adjustStock', 'hard_hats', 'One Size', 3, 'delivery', 2);
    const l = db.Issuance_Log.find(l => l.employee_id === emp('Eze Uba').employee_id && l.item_id === 'hard_hats');
    await call(S, 'issueBatch', [{ lineId: l.line_id, size: 'One Size' }]);
    await call(A, 'undoCollection', l.line_id, 'mistake');
    assert.strictEqual(emp('Eze Uba').status, 'Approved — Pending Collection');
  });

  await test('employee IDs are never reused after a deletion', async () => {
    await call(A, 'addEmployee', 'Fay One', 'Other'); await call(A, 'approveEmployee', emp('Fay One').internal_id);
    await call(A, 'addEmployee', 'Gus Two', 'Other'); await call(A, 'approveEmployee', emp('Gus Two').internal_id);
    const gusId = emp('Gus Two').employee_id;
    await call(A, 'deleteEmployee', emp('Fay One').internal_id);
    await call(A, 'addEmployee', 'Hal Three', 'Other'); await call(A, 'approveEmployee', emp('Hal Three').internal_id);
    assert.notStrictEqual(emp('Hal Three').employee_id, gusId);
    const ids = db.Employees.map(e => e.employee_id).filter(Boolean); assert.strictEqual(new Set(ids).size, ids.length);
  });

  await test('discarding a pending employee also removes their draft lines (no orphans)', async () => {
    await call(A, 'addEmployee', 'Ivy Four', 'Field Officer'); const i = emp('Ivy Four');
    await call(A, 'deleteEmployee', i.internal_id);
    assert.ok(!db.Issuance_Log.some(l => l.employee_id === i.internal_id));
  });

  await test('a brand-new role is just data: a rule creates it, and it then auto-assigns', async () => {
    await call(A, 'setRule', 'HSE Officer', 'hard_hats', 1, true); await call(A, 'setRule', 'HSE Officer', 'goggles', 2, true);
    const r = await call(A, 'addEmployee', 'Jo Five', 'HSE Officer');
    assert.strictEqual(r.result.drafted, 2);
  });

  await test('stock can never go below zero; insufficient stock leaves the item pending', async () => {
    await fails(call(A, 'adjustStock', 'umbrella', 'One Size', -1, 'oops'), /below zero/);
    const l = db.Issuance_Log.find(x => x.item_id === 'umbrella' && x.item_status === 'Pending');
    const r = await call(S, 'issueBatch', [{ lineId: l.line_id, size: 'One Size' }]);
    assert.deepStrictEqual(r.result.skipped, ['umbrella']); assert.strictEqual(r.result.issued, 0);
    assert.strictEqual(db.Issuance_Log.find(x => x.line_id === l.line_id).item_status, 'Pending');
  });

  console.log(`\nAll ${n} checks passed.`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
