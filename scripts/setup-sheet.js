/**
 * Run once, locally, after creating the Google Sheet and sharing it with
 * the service account (Editor access). Reads the same env vars as the
 * API (.env or your shell) plus two admin credentials you choose now.
 *
 *   node scripts/setup-sheet.js "Admin Username" "AdminPassword123" "Store Keeper Username" "StoreKeeperPassword123"
 */
require('dotenv').config();
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { SCHEMA, CATALOGUE, DEFAULT_RULES } = require('../lib/catalog');

async function main() {
  const [adminUser, adminPass, skUser, skPass] = process.argv.slice(2);
  if (!adminUser || !adminPass || !skUser || !skPass) {
    console.error('Usage: node scripts/setup-sheet.js <adminUsername> <adminPassword> <storeKeeperUsername> <storeKeeperPassword>');
    process.exit(1);
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const sheetId = process.env.SHEET_ID;
  if (!email || !key || !sheetId) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and SHEET_ID first (see .env.example).');

  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));

  // 1. create any missing tabs
  const toCreate = Object.keys(SCHEMA).filter(t => !existing.has(t));
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: toCreate.map(title => ({ addSheet: { properties: { title } } })) }
    });
  }

  // 2. write headers + freeze row 1
  for (const [tab, headers] of Object.entries(SCHEMA)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] }
    });
  }

  // 3. seed Item_Catalog + Inventory from the canonical catalogue
  const itemRows = CATALOGUE.map(c => [c.id, c.category, c.description, c.size_type, c.uom, true]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `'Item_Catalog'!A2`, valueInputOption: 'RAW', requestBody: { values: itemRows }
  });

  const invRows = [];
  CATALOGUE.forEach(c => c.sizes.forEach(sz => invRows.push([c.id, sz, 0, 10, ''])));
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `'Inventory'!A2`, valueInputOption: 'RAW', requestBody: { values: invRows }
  });

  // 4. seed default entitlement rules
  const ruleRows = DEFAULT_RULES.map(([role, itemId, qty], i) => [`rule-${i + 1}`, role, itemId, qty, true]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `'Entitlement_Rules'!A2`, valueInputOption: 'RAW', requestBody: { values: ruleRows }
  });

  // 5. seed the first two logins
  const adminHash = await bcrypt.hash(adminPass, 10);
  const skHash = await bcrypt.hash(skPass, 10);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `'Users'!A2`, valueInputOption: 'RAW',
    requestBody: { values: [[adminUser, adminHash, 'Admin', adminUser], [skUser, skHash, 'Store Keeper', skUser]] }
  });

  console.log('Sheet seeded. Tabs:', Object.keys(SCHEMA).join(', '));
  console.log(`Inventory currently shows 0 on hand for every size — load real counts from Inventory - PPEs.xlsx via the app's Inventory tab, or paste them straight into the Inventory sheet tab.`);
}

main().catch(e => { console.error(e); process.exit(1); });
