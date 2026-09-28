const { google } = require('googleapis');
const { SCHEMA } = require('./catalog');

let _client = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new Error('Server misconfigured: missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY.');
  key = key.replace(/\\n/g, '\n'); // Vercel env vars can't hold real newlines
  return new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
}

async function client() {
  if (_client) return _client;
  const auth = getAuth();
  await auth.authorize();
  _client = google.sheets({ version: 'v4', auth });
  return _client;
}

function sheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('Server misconfigured: missing SHEET_ID.');
  return id;
}

function rowsToObjects(headers, rows) {
  return (rows || []).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

function objectsToRows(headers, objects) {
  return objects.map(o => headers.map(h => (o[h] === undefined || o[h] === null ? '' : o[h])));
}

/** Read every tab in one batch call. Returns { TabName: [ {col: val, ...}, ... ] } */
async function readSnapshot() {
  const sheets = await client();
  const tabs = Object.keys(SCHEMA);
  const ranges = tabs.map(t => `'${t}'!A2:Z`);
  const resp = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId(), ranges });
  const out = {};
  tabs.forEach((t, i) => {
    out[t] = rowsToObjects(SCHEMA[t], resp.data.valueRanges[i].values || []);
  });
  return out;
}

/** Overwrite a whole tab's data rows (headers untouched) with `objects`. */
async function writeTable(tabName, objects) {
  const sheets = await client();
  const headers = SCHEMA[tabName];
  if (!headers) throw new Error('Unknown table: ' + tabName);
  const rows = objectsToRows(headers, objects);
  // Clear existing data rows first so a shrinking table doesn't leave stale rows behind.
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId(), range: `'${tabName}'!A2:Z100000` });
  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${tabName}'!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
  }
}

/** Write several tabs in one batchUpdate call — used whenever a single
 * action touches more than one table (e.g. issuing PPE touches
 * Issuance_Log + Inventory + Stock_Movements) so nothing is left
 * half-written if the request fails partway. */
async function writeTables(tableMap) {
  const sheets = await client();
  const data = [];
  for (const [tabName, objects] of Object.entries(tableMap)) {
    const headers = SCHEMA[tabName];
    if (!headers) throw new Error('Unknown table: ' + tabName);
    const rows = objectsToRows(headers, objects);
    // pad a generous fixed block so old rows are overwritten, not left dangling
    const width = headers.length;
    const blankRow = new Array(width).fill('');
    const padded = rows.concat(new Array(Math.max(0, 2000 - rows.length)).fill(blankRow));
    data.push({ range: `'${tabName}'!A2`, values: padded });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: { valueInputOption: 'RAW', data }
  });
}

module.exports = { readSnapshot, writeTable, writeTables };
