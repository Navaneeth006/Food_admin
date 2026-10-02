/**
 * Print a SHA-256 hash for ADMIN_PIN_SHA256.
 * Usage: node server/scripts/pin-hash.js <new-pin>
 */
import crypto from 'node:crypto';

const pin = process.argv[2];
if (!pin) {
  console.error('Usage: node server/scripts/pin-hash.js <new-pin>');
  process.exit(1);
}
console.log(crypto.createHash('sha256').update(pin, 'utf8').digest('hex'));
