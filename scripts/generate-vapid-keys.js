/**
 * Run once:  node scripts/generate-vapid-keys.js
 * Prints a public/private keypair for Web Push. Put VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY into your Vercel project's environment variables
 * (and VAPID_PUBLIC_KEY into index.html's PUSH_PUBLIC_KEY constant —
 * the public key is safe to embed in the frontend, it is not a secret).
 */
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nAdd both to Vercel → Project → Settings → Environment Variables.');
console.log('Also paste the PUBLIC key into index.html where it says PASTE_YOUR_VAPID_PUBLIC_KEY_HERE.\n');
