const { google } = require('googleapis');
const { SCHEMA, NUMERIC_COLUMNS, BOOLEAN_COLUMNS } = require('./catalog');

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

const isTrue = (v) => v === true || String(v).trim().toLowerCase() === 'true';

/** Turn raw sheet rows into typed objects: numbers are numbers, booleans are
 * booleans, everything else is text. Removes a whole class of bugs where
 * "TRUE" (text) !== true, or "38" !== 38, depending on how a cell was typed. */
function rowsToObjects(tab, headers, rows) {
  const nums = NUMERIC_COLUMNS[tab] || [];
  const bools = BOOLEAN_COLUMNS[tab] || [];
  return (rows || [])
    .filter(r => r.some(c => c !== '' && c !== undefined && c !== null)) // ignore blank rows
    .map(r => {
      const o = {};
      headers.forEach((h, i) => {
        const raw = r[i] === undefined || r[i] === null ? '' : r[i];
        if (nums.includes(h)) o[h] = Number(raw) || 0;
        else if (bools.includes(h)) o[h] = isTrue(raw);
        else o[h] = String(raw);
      });
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
  const ranges = tabs.map(t => `'${t}'!A2:Z10000`);
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId(), ranges, valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const out = {};
  tabs.forEach((t, i) => { out[t] = rowsToObjects(t, SCHEMA[t], resp.data.valueRanges[i].values || []); });
  return out;
}

/** Write one or more tabs in a single batchUpdate (so an action that touches
 * several tables is not left half-written), then clear any stale rows below
 * the new end of each table — works for tables of any size. */
async function writeTables(tableMap) {
  const sheets = await client();
  const data = [];
  const clears = [];
  for (const [tabName, objects] of Object.entries(tableMap)) {
    const headers = SCHEMA[tabName];
    if (!headers) throw new Error('Unknown table: ' + tabName);
    const rows = objectsToRows(headers, objects);
    if (rows.length) data.push({ range: `'${tabName}'!A2`, values: rows });
   clears.push(`'${tabName}'!A${rows.length + 2}:Z10000`);
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId(), requestBody: { valueInputOption: 'RAW', data }
    });
  }
  await sheets.spreadsheets.values.batchClear({ spreadsheetId: sheetId(), requestBody: { ranges: clears } });
}

const writeTable = (tabName, objects) => writeTables({ [tabName]: objects });

module.exports = { readSnapshot, writeTable, writeTables, rowsToObjects };
