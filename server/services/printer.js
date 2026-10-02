/**
 * Printer layer. A single interface `send(payload)` with swappable drivers so
 * different hardware can be added without touching business logic.
 * Drivers:
 *   simulated      — writes ESC/POS bytes to data/prints/*.bin (always works)
 *   escpos-usb     — node-escpos USB backend
 *   escpos-network — raw TCP to host:9100 (most WiFi/LAN thermal printers)
 *   escpos-serial  — node-escpos serial backend
 *   bluetooth      — POST raw bytes to a small HTTP bridge (BT printers, incl. iOS proxies)
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/database.js';

// ---------- ESC/POS byte builder (zero dependencies) ----------
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

function enc(text) {
  // Most budget thermal printers ship CP437 and cannot print ₹; render it as Rs.
  return new TextEncoder().encode(String(text).replace(/₹/g, 'Rs.'));
}

/** Turn receipt blocks into raw ESC/POS bytes. */
export function buildEscposBytes(blocks, { widthChars = 32 } = {}) {
  const out = [];
  const push = (...bytes) => {
    for (const b of bytes) {
      if (typeof b === 'number') out.push(b & 0xff);
      else for (const x of b) out.push(x & 0xff);
    }
  };

  push(ESC, 0x40); // initialize printer
  push(ESC, 0x74, 0x00); // codepage CP437 (safest on clones)

  for (const block of blocks) {
    const big = !!block.big;
    const align = block.align === 'left' ? 0 : 1;
    push(ESC, 0x61, align); // justification
    if (big) push(GS, 0x21, 0x11); // double width + double height
    else push(GS, 0x21, 0x00);
    push(ESC, 0x45, 0); // emphasize off
    push(enc(block.text), LF);
  }

  push(ESC, 0x61, 0);
  push(GS, 0x21, 0x00);
  // feed + partial cut
  push(LF, LF, LF);
  push(GS, 0x56, 0x42, 0x00);
  return new Uint8Array(out);
}

// ---------- drivers ----------
async function writeSimulated(bytes, orderNumber, kind) {
  const dir = path.resolve(config.root, 'data', 'prints');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${orderNumber}-${Date.now()}.bin`);
  fs.writeFileSync(file, Buffer.from(bytes));
  return { ok: true, detail: `wrote ${file}` };
}

async function writeNetwork(bytes) {
  const { host, port } = config.printer;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      socket.write(Buffer.from(bytes), () => {
        socket.end();
        resolve({ ok: true, detail: `sent ${bytes.length} bytes to ${host}:${port}` });
      });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`printer timeout ${host}:${port}`)); });
    socket.on('error', (e) => reject(e));
  });
}

async function writeBluetooth(bytes) {
  if (!config.printer.btUrl) throw new Error('BT_PRINTER_URL not configured');
  const res = await fetch(config.printer.btUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from(bytes),
  });
  if (!res.ok) throw new Error(`BT bridge responded ${res.status}`);
  return { ok: true, detail: 'sent to bluetooth bridge' };
}

async function writeEscposModule(bytes, backendName) {
  let backend;
  try {
    const mod = await import(`escpos-${backendName}`);
    backend = mod.default ?? mod;
  } catch {
    throw new Error(`Optional dependency "escpos-${backendName}" is not installed. Run: npm i escpos escpos-${backendName}`);
  }
  // node-escpos expects its own Printer wrapper; keep this thin and generic.
  const escpos = (await import('escpos').catch(() => null))?.default ?? null;
  if (!escpos) throw new Error('Optional dependency "escpos" is not installed.');
  await new Promise((resolve, reject) => {
    const device = new backend();
    const printer = new escpos.Printer(device, { encoding: 'GB18030' });
    device.open((err) => {
      if (err) return reject(err);
      printer
        .text(Buffer.from(bytes).toString('binary'))
        .close();
      device.close(() => resolve({ ok: true, detail: `escpos-${backendName} ok` }));
    });
  });
  return { ok: true, detail: `escpos-${backendName}` };
}

// ---------- job queue ----------
const COOLDOWN_MS = 1200;

/** Send pre-built ESC/POS bytes straight to the active driver (test print). */
export async function sendRawToPrinter(bytes) {
  const driver = activeDriver();
  switch (driver) {
    case 'escpos-network': return writeNetwork(bytes);
    case 'bluetooth': return writeBluetooth(bytes);
    case 'escpos-usb': return writeEscposModule(bytes, 'usb');
    case 'escpos-serial': return writeEscposModule(bytes, 'serial');
    default: return writeSimulated(bytes, 'test', 'test');
  }
}

/**
 * Mark an order paid and enqueue its prints. This is the SINGLE integration
 * point a real gateway will call after it VERIFIES payment server-side
 * (see docs/PHONEPE_INTEGRATION.md). The kiosk itself can never call this.
 */
export function markOrderPaid(orderId, { provider = 'test', paymentRef = null } = {}) {
  const tx = db.transaction(() => {
    const o = db.prepare('SELECT payment_status, order_number FROM orders WHERE id = ?').get(orderId);
    if (!o) throw new Error('order not found');
    if (o.payment_status === 'paid') return { already: true, orderNumber: o.order_number };
    db.prepare(
      `UPDATE orders SET payment_status='paid', status='new', payment_provider=?, payment_ref=?, paid_at=datetime('now') WHERE id=?`
    ).run(provider, paymentRef, orderId);
    return { already: false, orderNumber: o.order_number };
  });
  const r = tx();
  if (!r.already) {
    try {
      enqueuePrint(orderId, 'receipt');
    } catch (err) {
      // never fail the paid transition because of printing; jobs can be retried from admin
      console.error('[print] enqueue failed:', err.message);
    }
  }
  return r;
}

export function enqueuePrint(orderId, kind = 'receipt') {
  const info = db
    .prepare(`INSERT INTO print_jobs (order_id, kind, status) VALUES (?, ?, 'queued')`)
    .run(orderId, kind);
  setImmediate(() => processJob(info.lastInsertRowid));
  return info.lastInsertRowid;
}

async function processJob(jobId) {
  const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId);
  if (!job || job.status === 'printed') return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(job.order_id);
  if (!order) { fail(jobId, 'order missing'); return; }
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  order.items = items;

  // Lazy import avoids a cycle: receipt.js imports settings from the db, not this file.
  const { buildReceipt } = await import('./receipt.js');
  const { blocks, fontScale } = buildReceipt(order);
  const widthChars = parseInt(getSettingWidth(), 10) || 32;
  const bytes = buildEscposBytes(blocks, { widthChars });

  try {
    const driver = activeDriver();
    let result;
    switch (driver) {
      case 'escpos-network': result = await writeNetwork(bytes); break;
      case 'bluetooth': result = await writeBluetooth(bytes); break;
      case 'escpos-usb': result = await writeEscposModule(bytes, 'usb'); break;
      case 'escpos-serial': result = await writeEscposModule(bytes, 'serial'); break;
      default: result = await writeSimulated(bytes, order.order_number, job.kind);
    }
    db.prepare(`UPDATE print_jobs SET status='printed', printed_at=datetime('now'), last_error='' WHERE id=?`).run(jobId);
    db.prepare(`UPDATE orders SET print_status='printed' WHERE id=?`).run(order.id);
    return result;
  } catch (err) {
    fail(jobId, err.message);
    // single retry after cooldown
    setTimeout(() => retryJob(jobId), COOLDOWN_MS);
  }
}

function retryJob(jobId) {
  const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId);
  if (!job || job.status === 'printed') return;
  if (job.attempts >= 2) return; // stays 'failed' for admin retry
  db.prepare('UPDATE print_jobs SET attempts = attempts + 1 WHERE id = ?').run(jobId);
  processJob(jobId);
}

function fail(jobId, message) {
  db.prepare(`UPDATE print_jobs SET status='failed', last_error=? WHERE id=?`).run(String(message).slice(0, 300), jobId);
  const job = db.prepare('SELECT order_id FROM print_jobs WHERE id=?').get(jobId);
  if (job) db.prepare(`UPDATE orders SET print_status='failed' WHERE id=?`).run(job.order_id);
}

/** Retry a failed print from the admin dashboard. */
export function reprintJob(jobId) {
  db.prepare(`UPDATE print_jobs SET status='queued', attempts=0, last_error='' WHERE id=? AND status='failed'`).run(jobId);
  setImmediate(() => processJob(jobId));
}

/** All print jobs (admin print queue view). */
export function listPrintJobs({ status, limit = 100 } = {}) {
  let sql = `SELECT j.*, o.order_number FROM print_jobs j JOIN orders o ON o.id = j.order_id`;
  const args = [];
  if (status) { sql += ' WHERE j.status = ?'; args.push(status); }
  sql += ' ORDER BY j.id DESC LIMIT ?';
  args.push(Math.min(500, Math.max(1, limit)));
  return db.prepare(sql).all(...args);
}

export function activeDriver() {
  return config.printer.driver || 'simulated';
}

export function printerStatus() {
  const driver = activeDriver();
  const base = {
    driver,
    configured: true,
    hint: '',
  };
  if (driver === 'simulated') {
    base.hint = 'Simulation mode: print jobs are written to data/prints/*.bin. Configure a real driver in .env.';
  }
  if (driver === 'bluetooth' && !config.printer.btUrl) {
    base.configured = false;
    base.hint = 'BT_PRINTER_URL is not set.';
  }
  return base;
}

function getSettingWidth() {
  // imported late to dodge circular import; database.js has no dependency on this file
  return db.prepare("SELECT value FROM settings WHERE key='paper_width_chars'").get()?.value ?? '32';
}
