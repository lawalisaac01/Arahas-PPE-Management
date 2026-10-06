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

  // ---------- stock count: upload + counting links ----------
  const pub = (fn, ...a) => handle({ fn, args: a });
  const moves = () => db.Stock_Movements.length;

  await test('stock count SETS on-hand and defective; blank figures leave a size as it is', async () => {
    stock('coverall_single', 'L').qty_on_hand = 7; stock('coverall_single', 'M').qty_on_hand = 3;
    const before = moves();
    const r = await call(S, 'applyStockCount', 'count', [
      { item_id: 'coverall_single', size: 'L', qty: 45, defective: 2 },
      { item_id: 'coverall_single', size: 'M', qty: null, defective: 1 },
      { item_id: 'coverall_single', size: 'XL', qty: 0, defective: null }
    ], 'register.xlsx');
    assert.strictEqual(stock('coverall_single', 'L').qty_on_hand, 45); assert.strictEqual(stock('coverall_single', 'L').qty_defective, 2);
    assert.strictEqual(stock('coverall_single', 'M').qty_on_hand, 3); assert.strictEqual(stock('coverall_single', 'M').qty_defective, 1);
    assert.ok(stock('coverall_single', 'XL').last_updated, 'a counted size with no change is still stamped as counted');
    assert.strictEqual(r.result.changed, 2); assert.strictEqual(moves(), before + 2);
    const mv = db.Stock_Movements.find(m => m.item_id === 'coverall_single' && m.size === 'L' && m.delta === 38);
    assert.match(mv.reason, /Stock count — register\.xlsx · defective 0→2/); assert.strictEqual(mv.actor, 'store');
  });

  await test('delivery ADDS to on-hand and defective', async () => {
    await call(A, 'applyStockCount', 'delivery', [{ item_id: 'coverall_single', size: 'L', qty: 10, defective: 1 }], 'GRN 42');
    assert.strictEqual(stock('coverall_single', 'L').qty_on_hand, 55); assert.strictEqual(stock('coverall_single', 'L').qty_defective, 3);
  });

  await test('bad count lines are refused and nothing is written', async () => {
    const snapBefore = JSON.stringify(db.Inventory);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'coverall_single', size: 'XS', qty: 1 }], 'x'), /not set up/);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'coverall_single', size: 'L', qty: 1 }, { item_id: 'coverall_single', size: 'L', qty: 2 }], 'x'), /more than once/);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'coverall_single', size: 'L', qty: -1 }], 'x'), /whole number/);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'coverall_single', size: 'L', qty: 2.5 }], 'x'), /whole number/);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'nope', size: 'L', qty: 1 }], 'x'), /catalogue/);
    await fails(call(A, 'applyStockCount', 'replace', [{ item_id: 'coverall_single', size: 'L', qty: 1 }], 'x'), /Stock count/);
    assert.strictEqual(JSON.stringify(db.Inventory), snapBefore);
  });

  await test('counting link: open without sign-in, blind (no stock figures), submit once, then apply', async () => {
    const { result: link } = await call(S, 'createCountLink', 'Main store', 24, 'count');
    const open = await pub('countLinkOpen', link.token);
    assert.ok(!('snapshot' in open)); assert.ok(!/qty_on_hand|password|SECRET/.test(JSON.stringify(open)));
    assert.ok(open.result.items.find(i => i.item_id === 'goggles').sizes.includes('Clear'));
    await fails(pub('countLinkSubmit', link.token, 'X', [{ item_id: 'goggles', size: 'Clear', qty: 5 }]), /your name/);
    await pub('countLinkSubmit', link.token, 'Musa Bello', [{ item_id: 'goggles', size: 'Clear', qty: 51 }, { item_id: 'goggles', size: 'Dark', qty: 82, defective: 0 }]);
    await fails(pub('countLinkOpen', link.token), /already been submitted/);
    await fails(pub('countLinkSubmit', link.token, 'Musa Bello', [{ item_id: 'goggles', size: 'Clear', qty: 1 }]), /already been submitted/);
    const row = db.Stock_Counts.find(c => c.count_id === link.count_id);
    assert.strictEqual(row.status, 'Submitted'); assert.deepStrictEqual(JSON.parse(row.lines_json)[0], ['goggles', 'Clear', 51, null]);
    await call(S, 'applyStockCount', 'count', [{ item_id: 'goggles', size: 'Clear', qty: 51 }], 'ignored', link.count_id);
    assert.strictEqual(stock('goggles', 'Clear').qty_on_hand, 51); assert.strictEqual(row.status === 'Submitted', true, 'local copy unchanged');
    const saved = db.Stock_Counts.find(c => c.count_id === link.count_id);
    assert.strictEqual(saved.status, 'Applied'); assert.strictEqual(saved.applied_by, 'store');
    assert.match(db.Stock_Movements.at(-1).reason, /counting link "Main store" by Musa Bello/);
    await fails(call(A, 'applyStockCount', 'count', [{ item_id: 'goggles', size: 'Clear', qty: 1 }], 'x', link.count_id), /already been applied/);
  });

  await test('counting link: wrong, cancelled and expired links are refused', async () => {
    await fails(pub('countLinkOpen', 'not-a-real-token'), /not valid/);
    await fails(pub('countLinkOpen', ''), /not valid/);
    const { result: a } = await call(A, 'createCountLink', '', 8);
    await call(A, 'cancelCountLink', a.count_id);
    await fails(pub('countLinkOpen', a.token), /cancelled/);
    const { result: b } = await call(A, 'createCountLink', '', 8);
    db.Stock_Counts.find(c => c.count_id === b.count_id).expires_at = new Date(Date.now() - 1000).toISOString();
    await fails(pub('countLinkSubmit', b.token, 'Ada', [{ item_id: 'goggles', size: 'Clear', qty: 1 }]), /expired/);
    await fails(call(A, 'createCountLink', '', 0), /1 hour to 14 days/);
  });

  await test('reader: stock register layout (merged items, headings, TOTAL rows, "51/82") is matched without guessing', async () => {
    const SI = require('../stock-import');
    const cat = CATALOGUE.map(c => ({ item_id: c.id, category: c.category, description: c.description, uom: c.uom, sizes: c.sizes }));
    const boot = (brand) => `Safety Boot\nType: Low/Ankle Shoes\nBrand : ${brand}\nStandard: BS EN ISO 20345, ASTM F2413-18 & ASTM F3445-21`;
    const rows = [[null, 'ARAHAS · PPE STOCK REGISTER'], [], [null, 'ITEM DESCRIPTION', 'SIZE', 'AVAILABLE STOCK', 'DEFECTIVE STOCK'],
      [null, 'SAFETY BOOTS'], [null, boot('Safety Joggers'), 50, 5, null], [null, null, 49, 0, null], [null, 'TOTAL', null, 5, 0],
      [null, boot('Redwings'), 50, null, null], [null, null, 43, 6, 1], [null, 'TOTAL', null, 6, 1],
      [null, 'COVERALL'], [null, 'Coverall (2 Piece)\nType: Flame-Resistant Workwear\nBrand : Red Wing', 'XXL', 1, 1],
      [null, 'Safety googles\nBrand: Astrospec 3000 · Black Frame', 'Uvex (Clear and Dark)', '51/82', 0],
      [null, 'Ear plugs (3M UltraFit™)', '3M Ear plugs- corded', 250, null], [null, 'Raincoat (Zutech Safety)', 'XXXL', 1, null],
      [null, 'Face shield', null, 4, null], [null, 'UMBRELLA'], [null, 'Umbrella', null, null, null]];
    const r = SI.parse(rows, cat);
    const got = r.lines.map(l => [l.item_id, l.size, l.qty, l.defective, l.blank, l.problems.length]);
    assert.deepStrictEqual(got, [
      ['safety_joggers', '50', 5, null, false, 0], ['safety_joggers', '49', 0, null, false, 0],
      ['redwings', '50', null, null, true, 0], ['redwings', '43', 6, 1, false, 0],
      ['coverall_2piece', 'XXL', 1, 1, false, 0],
      ['goggles', 'Clear', 51, 0, false, 0], ['goggles', 'Dark', 82, 0, false, 0],
      ['ear_plugs', 'Corded', 250, null, false, 0], ['raincoat_zutech', 'XXXL', 1, null, false, 0],
      [null, null, 4, null, false, 1]
    ]);
    assert.match(r.lines[5].notes[0], /Split "51\/82"/);
    assert.strictEqual(r.lines[0].row, 5, 'row numbers match the sheet');
  });

  await test('reader: plain lists, item codes, 2XL/Large sizes, and "unsure" flags', async () => {
    const SI = require('../stock-import');
    const cat = CATALOGUE.map(c => ({ item_id: c.id, category: c.category, description: c.description, uom: c.uom, sizes: c.sizes }));
    const r = SI.parse(SI.parseCSV('Item code,Item,Size,Unit,Available,Defective\r\nhard_hats,Hard Hats,One Size,Pieces,20,\r\n,Coverall single,2XL,,10,\r\n,Red wings,43,,5,\r\n,Gloves,Large,,12,\r\n,Cotton gloves,,,7,\r\n,Ear plug,,,2.5,\r\n'), cat);
    const got = r.lines.map(l => [l.item_id, l.size, l.qty, l.problems.join('|')]);
    assert.deepStrictEqual(got, [
      ['hard_hats', 'One Size', 20, ''], ['coverall_single', 'XXL', 10, ''], ['redwings', '43', 5, ''],
      ['impact_gloves', 'Large', 12, 'Item uncertain — please confirm'], ['cotton_gloves', 'Large', 7, ''],
      ['ear_plugs', 'Corded', null, 'Can\'t use "2.5" — whole numbers only']
    ]);
    assert.match(r.lines[2].notes[0], /Matched by size 43/);
    assert.ok(SI.parse([['a', 'b'], [1, 2]], cat).error);
  });

  console.log(`\nAll ${n} checks passed.`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
