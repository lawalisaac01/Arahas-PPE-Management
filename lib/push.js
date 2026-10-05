/**
 * Web Push notifications (the "ping Caleb / the store keeper" feature).
 * Uses VAPID keys — see scripts/generate-vapid-keys.js and MANUAL.md §2.5.
 * Best-effort by design: a push failure never breaks the action that
 * triggered it (approving an employee still succeeds even if nobody
 * has notifications turned on, or a phone is offline).
 */
const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false; // notifications are opt-in infra; silently no-op until set up
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:qhse@arahas.example', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

/**
 * Send `payload` (plain object — title/body/tag/url) to every subscription
 * belonging to `role` in snap.Push_Subscriptions. Mutates snap in place to
 * drop subscriptions the browser has revoked (410/404), same pattern as
 * every other handler in api/rpc.js — caller is responsible for persisting
 * snap.Push_Subscriptions if it changed (see notifyRole's `changed` return).
 */
async function notifyRole(snap, role, payload) {
  if (!ensureConfigured()) return false;
  const subs = (snap.Push_Subscriptions || []).filter(s => s.role === role);
  if (!subs.length) return false;
  const body = JSON.stringify(payload);
  let changed = false;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        snap.Push_Subscriptions = snap.Push_Subscriptions.filter(x => x.sub_id !== s.sub_id);
        changed = true;
      }
      // any other error (offline device, transient network) is left alone — not fatal, not a reason to unsubscribe
    }
  }));
  return changed;
}

module.exports = { notifyRole, ensureConfigured };
