import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function intEnv(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

// Default admin PIN is "1234" (demo). Its SHA-256 is pre-filled below.
const DEFAULT_PIN_SHA256 = crypto.createHash('sha256').update('1234').digest('hex');

export const config = {
  root: ROOT,
  port: intEnv('PORT', 4242) || 4242, // guard against PORT=0 in some sandboxes
  host: env('HOST', '0.0.0.0'),
  env: env('NODE_ENV', 'development'),

  adminPinSha256: env('ADMIN_PIN_SHA256', DEFAULT_PIN_SHA256),
  sessionSecret: env('SESSION_SECRET', 'dev-secret-change-me'),
  forceHttps: env('FORCE_HTTPS', 'false') === 'true',

  dbPath: path.resolve(ROOT, env('DB_PATH', 'data/kiosk.db')),
  uploadDir: path.resolve(ROOT, env('UPLOAD_DIR', 'data/uploads')),

  paymentMode: env('PAYMENT_MODE', 'test'), // 'test' | 'live'
  paymentProvider: env('PAYMENT_PROVIDER', 'none'), // 'none' until gateway is integrated (e.g. 'phonepe')
  phonepeMerchantId: env('PHONEPE_MERCHANT_ID', ''),
  phonepeSaltKey: env('PHONEPE_SALT_KEY', ''),
  phonepeSaltIndex: env('PHONEPE_SALT_INDEX', '1'),
  phonepeEnv: env('PHONEPE_ENV', 'UAT'),
  currency: env('CURRENCY', 'INR'),
  vpa: env('VPA', 'foodtruck@upi'),
  payeeName: env('PAYEE_NAME', 'FOOD TRUCK'),

  printer: {
    driver: env('PRINTER_DRIVER', 'simulated'), // simulated|escpos-usb|escpos-network|escpos-serial|bluetooth
    host: env('PRINTER_HOST', '192.168.1.100'),
    port: intEnv('PRINTER_PORT', 9100),
    device: env('PRINTER_DEVICE', '/dev/usb/lp0'),
    btUrl: env('BT_PRINTER_URL', ''),
  },

  autoResetSeconds: intEnv('AUTO_RESET_SECONDS', 20),
  maxQtyPerItem: intEnv('MAX_QTY_PER_ITEM', 10),

  sessionTtlHours: intEnv('SESSION_TTL_HOURS', 12),
};

export function ensureDataDirs() {
  for (const p of [path.dirname(config.dbPath), config.uploadDir]) {
    fs.mkdirSync(p, { recursive: true });
  }
}
