const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TTL_MS = 12 * 60 * 60 * 1000; // 12h shift-length session

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('Server misconfigured: missing SESSION_SECRET.');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) throw new Error('Invalid session. Please sign in again.');
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid session. Please sign in again.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (Date.now() > payload.exp) throw new Error('Session expired. Please sign in again.');
  return payload;
}

function issueToken(user) {
  return sign({ username: user.username, role: user.role, display_name: user.display_name, exp: Date.now() + TTL_MS });
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash || '');
}

module.exports = { issueToken, verify, hashPassword, checkPassword };
