import Database from 'better-sqlite3';
import { config, ensureDataDirs } from '../config.js';

ensureDataDirs();

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_sha256 TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  emoji TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'addon',          -- addon | single
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  tax_label TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_provider TEXT,
  payment_ref TEXT,
  print_status TEXT NOT NULL DEFAULT 'none',   -- none|queued|printed|failed
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  unit_paise INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  modifiers TEXT NOT NULL DEFAULT '[]'          -- JSON [{name, price_paise}]
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',       -- created|paid|failed|refunded
  raw TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'receipt',         -- receipt|kitchen
  status TEXT NOT NULL DEFAULT 'queued',        -- queued|printed|failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT
);

CREATE TABLE IF NOT EXISTS printers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  driver TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 1,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

// ---- settings helpers (config, not hard-coding) ----
const defaults = {
  business_name: 'FOOD TRUCK',
  business_tagline: 'FRESH • HOT • FAST',
  address: '',
  phone: '',
  gst_number: '',
  gst_percent: '18',
  gst_label: 'GST incl',
  show_gst_on_receipt: '1',
  currency_symbol: '₹',
  order_prefix: '',
  receipt_header_lines: '',
  receipt_footer: 'Thank you! Please visit again.',
  thank_you_message: 'Thank you for your order!',
  show_phone: '1',
  show_address: '1',
  show_kitchen_slip: '0',
  show_cut_line: '1',
  receipt_align: 'center',
  receipt_font_scale: '1',
  paper_width_chars: '32',
  auto_reset_seconds: String(20),
  max_qty_per_item: String(10),
  bill_logo: '',
  demo_mode: '1',
};

const stmtGet = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSet = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const stmtAll = db.prepare('SELECT key, value FROM settings');

function ensureSettingsDefaults() {
  const existing = stmtAll.all();
  const map = new Map(existing.map((row) => [row.key, row.value]));

  for (const [key, value] of Object.entries(defaults)) {
    const existingValue = map.get(key);

    if (!existingValue) {
      stmtSet.run(key, String(value));
      continue;
    }

    if (key === 'show_kitchen_slip' && existingValue === '1') {
      stmtSet.run(key, '0');
    }

    if (key === 'show_gst_on_receipt' && existingValue === '0') {
      stmtSet.run(key, '1');
    }

    if (key === 'gst_percent' && (existingValue === '0' || existingValue === '')) {
      stmtSet.run(key, '18');
    }
  }
}

ensureSettingsDefaults();

export function getSetting(key) {
  const row = stmtGet.get(key);
  if (!row) return defaults[key];

  if (key === 'show_kitchen_slip' && row.value === '1') {
    stmtSet.run(key, '0');
    return '0';
  }

  if (key === 'show_gst_on_receipt' && row.value === '0') {
    stmtSet.run(key, '1');
    return '1';
  }

  if (key === 'gst_percent' && (row.value === '0' || row.value === '')) {
    stmtSet.run(key, '18');
    return '18';
  }

  return row.value;
}
export function setSetting(key, value) {
  stmtSet.run(key, String(value));
}
export function getAllSettings() {
  const out = { ...defaults };
  for (const row of stmtAll.iterate()) out[row.key] = row.value;
  return out;
}
export function setSettings(obj) {
  const tx = db.transaction((o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k in defaults || k === 'bill_logo') setSetting(k, v);
    }
  });
  tx(obj);
}

export function nextOrderNumber() {
  // Sequential, backend-assigned, duplicate-proof. Starts at 1001 by default.
  const row = db
    .prepare(
      "INSERT INTO counters (name, value) VALUES ('order_number', 1001) " +
        'ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value'
    )
    .get();
  return row.value;
}
