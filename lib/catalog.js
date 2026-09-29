/**
 * ARAHAS PPE — canonical catalogue & sheet schema.
 * Single source of truth so the Google Sheet, the seed script and the
 * API all agree on tab names, column order and item IDs.
 */

// Tab name -> column headers (order = column order in the sheet)
const SCHEMA = {
  Employees: ['internal_id', 'employee_id', 'name', 'role', 'department_site', 'date_added', 'status', 'approved_by', 'approved_date'],
  Entitlement_Rules: ['rule_id', 'role', 'item_id', 'default_qty', 'active'],
  Item_Catalog: ['item_id', 'item_category', 'item_description', 'size_type', 'uom', 'active'],
  Inventory: ['item_id', 'size', 'qty_on_hand', 'low_stock_threshold', 'last_updated'],
  Issuance_Log: ['line_id', 'issuance_id', 'employee_id', 'item_id', 'size', 'qty', 'date_issued', 'item_status', 'issued_by', 'batch_type', 'related_approval_id'],
  Replacement_Requests: ['request_id', 'employee_id', 'item_id', 'reason', 'requested_by', 'status', 'approved_by', 'approved_date'],
  Stock_Movements: ['movement_id', 'item_id', 'size', 'delta', 'reason', 'actor', 'timestamp'],
  Users: ['username', 'password_hash', 'role', 'display_name']
};

// Starting roles. Roles are DATA, not code: any role name that appears in the
// Entitlement_Rules tab is a valid role, so new roles never need a code change.
const ROLES = ['Field Officer', 'Coordinator', 'Supervisor', 'Other'];

// Google Sheets hands everything back loosely typed. These lists tell the
// reader which columns are numbers / booleans; every other column is text.
const NUMERIC_COLUMNS = {
  Entitlement_Rules: ['default_qty'],
  Inventory: ['qty_on_hand', 'low_stock_threshold'],
  Issuance_Log: ['qty'],
  Stock_Movements: ['delta']
};
const BOOLEAN_COLUMNS = { Entitlement_Rules: ['active'], Item_Catalog: ['active'] };

// Matches the groups already encoded in ppe-inventory.html so item_id
// values stay stable across every artifact in this project.
const CATALOGUE = [
  { id: 'safety_joggers', category: 'Safety Boots', description: 'Low/Ankle Shoes — Safety Joggers — BS EN ISO 20345, ASTM F2413-18 & ASTM F3445-21', size_type: 'Shoe size (38-50)', uom: 'Pairs', sizes: ['38','39','40','41','42','43','44','45','46','47','48','49','50'] },
  { id: 'redwings', category: 'Safety Boots', description: 'Low/Ankle Shoes — Redwings — BS EN ISO 20345, ASTM F2413-18 & ASTM F3445-21', size_type: 'Shoe size (38-50)', uom: 'Pairs', sizes: ['38','39','40','41','42','43','44','45','46','47','48','49','50'] },
  { id: 'coverall_single', category: 'Coverall (Single)', description: 'Flame-Resistant Workwear — Red Wing / Protex — EN ISO 11612:2015, EN ISO 14116:2015, EN ISO 11611:2015', size_type: 'Letter size (M-XXXXL)', uom: 'Pieces', sizes: ['M','L','XL','XXL','XXXL','XXXXL'] },
  { id: 'coverall_2piece', category: 'Coverall (2 Piece)', description: 'Flame-Resistant Workwear — Red Wing — EN ISO 11612:2015, EN ISO 14116:2015, EN ISO 11611:2015', size_type: 'Letter size (M-XXXXL)', uom: 'Pieces', sizes: ['M','L','XL','XXL','XXXL','XXXXL'] },
  { id: 'hard_hats', category: 'Hard Hats', description: 'MSA V-Gard — Type I, Class E & G — ANSI Z89.1-2003, CSA Z94.1-05', size_type: 'One size', uom: 'Pieces', sizes: ['One Size'] },
  { id: 'impact_gloves', category: 'Impact Resistant Hand Gloves', description: 'Large Size', size_type: 'One size', uom: 'Dozens', sizes: ['Large'] },
  { id: 'cotton_gloves', category: 'Cotton Dotted Hand Gloves', description: 'Beta Polka Dotted — Large Size', size_type: 'One size', uom: 'Dozens', sizes: ['Large'] },
  { id: 'ear_plugs', category: 'Ear Plugs', description: '3M UltraFit — OPTIME 3, 25 dB — AS/NZS 1270:2002 Class 3, NRR 25 dB (EPA)', size_type: 'One size', uom: 'Pieces', sizes: ['Corded'] },
  { id: 'earmuffs', category: 'Earmuffs', description: '3M — Hardhat mounted', size_type: 'One size', uom: 'Pieces', sizes: ['Hardhat Mounted'] },
  { id: 'goggles', category: 'Safety Goggles', description: 'Astrospec 3000 — Black Frame, Clear Lens — CSA Z94.3 / Z87.1+', size_type: 'One size', uom: 'Pieces', sizes: ['Clear','Dark'] },
  { id: 'rain_boot_trucker', category: 'Rain Boot', description: 'Steel Toe (NINGO), TRUCKER — EN 345-1 S5, ISO 6110, ISO 6112', size_type: 'Shoe size (38-50)', uom: 'Pieces', sizes: ['38','39','40','41','42','43','44','45','46','47','48','49','50'] },
  { id: 'raincoat_zutech', category: 'Rain Coat', description: 'Zutech Safety', size_type: 'Letter size (M-XXXL)', uom: 'Pieces', sizes: ['M','L','XL','XXL','XXXL'] },
  { id: 'umbrella', category: 'Umbrella', description: 'Standard issue', size_type: 'One size', uom: 'Pieces', sizes: ['One Size'] }
];

// Sensible MVP defaults — Caleb edits these from the Rules tab, this is
// only what a fresh sheet is seeded with.
const DEFAULT_RULES = [
  ['Field Officer', 'safety_joggers', 1], ['Field Officer', 'coverall_single', 2], ['Field Officer', 'hard_hats', 1],
  ['Field Officer', 'impact_gloves', 1], ['Field Officer', 'ear_plugs', 1], ['Field Officer', 'goggles', 1],
  ['Field Officer', 'rain_boot_trucker', 1], ['Field Officer', 'raincoat_zutech', 1], ['Field Officer', 'umbrella', 1],
  ['Coordinator', 'coverall_single', 2], ['Coordinator', 'hard_hats', 1], ['Coordinator', 'umbrella', 1],
  ['Supervisor', 'coverall_2piece', 2], ['Supervisor', 'hard_hats', 1], ['Supervisor', 'goggles', 1], ['Supervisor', 'umbrella', 1],
  ['Other', 'coverall_single', 1], ['Other', 'hard_hats', 1]
];

module.exports = { SCHEMA, ROLES, CATALOGUE, DEFAULT_RULES, NUMERIC_COLUMNS, BOOLEAN_COLUMNS };
