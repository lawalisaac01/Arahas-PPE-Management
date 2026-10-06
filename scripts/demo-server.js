/**
 * Local demo — no Google account needed:  node scripts/demo-server.js  → http://localhost:3000
 * Serves index.html and runs the REAL api/rpc.js against an in-memory sheet pre-loaded with
 * the stock counts from "PPE Register — Issued by GEP (Aug 2026)". Sign in: admin / demo  or  store / demo.
 * (Data resets when you stop it. Production uses the real Google Sheet.)
 */
process.env.SESSION_SECRET = 'demo';
const http = require('http'), fs = require('fs'), path = require('path'), Module = require('module');
const { SCHEMA, CATALOGUE, DEFAULT_RULES } = require('../lib/catalog');
const db = {}; Object.keys(SCHEMA).forEach(t => (db[t] = []));
CATALOGUE.forEach(c => {
  db.Item_Catalog.push({ item_id: c.id, item_category: c.category, item_description: c.description, size_type: c.size_type, uom: c.uom, active: true });
  c.sizes.forEach(s => db.Inventory.push({ item_id: c.id, size: s, qty_on_hand: 0, low_stock_threshold: 10, last_updated: '' }));
});
DEFAULT_RULES.forEach(([role, item_id, q], i) => db.Entitlement_Rules.push({ rule_id: 'rule-' + i, role, item_id, default_qty: q, active: true }));
db.Users.push({ username: 'admin', password_hash: 'x', role: 'Admin', display_name: 'Admin' }, { username: 'store', password_hash: 'x', role: 'Store Keeper', display_name: 'Store' });
// opening stock keyed from the register (sizes 38-47 etc.). Red Wing = sacks + boxes combined.
const REG = {
  redwings: { 38: 2, 39: 2, 40: 7, 41: 9, 42: 16, 43: 13, 44: 8, 45: 6, 46: 15, 47: 13, 48: 4, 49: 1 },
  safety_joggers: { 38: 3, 39: 0, 40: 3, 41: 8, 42: 14, 43: 7, 44: 13, 45: 23, 46: 9, 47: 0 },
  rain_boot_trucker: { 39: 5, 40: 3, 41: 19, 42: 20, 43: 16, 44: 5, 45: 10, 46: 11, 47: 32 },
  coverall_2piece: { L: 18, XL: 20, XXL: 10, XXXL: 2, XXXXL: 14 },
  coverall_single: { M: 12, L: 46, XL: 24, XXL: 18, XXXL: 52 },
  raincoat_zutech: { M: 6, L: 10, XL: 16, XXL: 1, XXXL: 7 },
  goggles: { Dark: 75, Clear: 66 }, hard_hats: { 'One Size': 27 }
};
const stamp = new Date().toISOString();
Object.entries(REG).forEach(([id, sizes]) => Object.entries(sizes).forEach(([sz, q]) => { const r = db.Inventory.find(x => x.item_id === id && x.size === sz); if (r) { r.qty_on_hand = q; r.last_updated = stamp; } }));

const clone = o => JSON.parse(JSON.stringify(o));
const fake = { readSnapshot: async () => clone(db), writeTables: async m => Object.entries(m).forEach(([t, r]) => (db[t] = clone(r))), writeTable: async (t, r) => (db[t] = clone(r)) };
const load = Module._load;
Module._load = function (req, ...a) { if (/lib[\\/]sheets$/.test(req)) return fake; if (req === 'bcryptjs') return { compare: async (p) => p === 'demo', hash: async () => 'x' }; return load.call(this, req, ...a); };
const { handle } = require('../api/rpc');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/rpc')) {
    let b = ''; req.on('data', c => (b += c)); req.on('end', async () => {
      let out; try { out = await handle(JSON.parse(b || '{}')); } catch (e) { out = { ok: false, error: e.message }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
    }); return;
  }
  let f = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html'; // like Vercel's cleanUrls: /count -> count.html
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 3000, () => console.log('Demo running on http://localhost:' + (process.env.PORT || 3000)));
