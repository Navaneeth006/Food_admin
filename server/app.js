import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config, ensureDataDirs } from './config.js';
import { db, getAllSettings, setSettings, getSetting } from './db/database.js';
import { priceCart, createOrder, getOrder, listOrders, todayStats, setOrderStatus } from './services/orders.js';
import { markOrderPaid, enqueuePrint, reprintJob, printerStatus, buildEscposBytes, listPrintJobs } from './services/printer.js';
import { buildReceipt } from './services/receipt.js';
import { verifyPin, createSession, destroySession, requireAdmin, tokenFromRequest, isValidSession } from './services/auth.js';
import { handler as sseHandler, broadcast } from './services/events.js';

ensureDataDirs();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// tiny logger
app.use((req, res, next) => {
  if (config.env !== 'test') console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

function bad(res, status, clientMessage, err) {
  res.status(status).json({ error: true, message: clientMessage });
  if (err) console.error('[api]', err.message);
}

function requireAdminPage(req, res, next) {
  if (isValidSession(tokenFromRequest(req))) return next();
  res.redirect('/admin/login');
}

// ---------- admin auth ----------
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body ?? {};
  if (!verifyPin(pin)) {
    setTimeout(() => res.status(401).json({ ok: false, message: 'Incorrect PIN' }), 400);
    return;
  }
  const { token, maxAgeSec } = createSession();
  res.setHeader('Set-Cookie', `kiosk_admin=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  destroySession(tokenFromRequest(req));
  res.setHeader('Set-Cookie', 'kiosk_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => {
  res.json({ authed: isValidSession(tokenFromRequest(req)) });
});

// ---------- public kiosk APIs ----------
app.get('/api/menu', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE available = 1 ORDER BY sort_order, id').all();
  const products = db
    .prepare('SELECT id, category_id, name, description, price_paise, image, emoji FROM products WHERE available = 1 ORDER BY sort_order, id')
    .all();
  const groups = db.prepare('SELECT * FROM modifier_groups ORDER BY sort_order, id').all();
  const mods = db.prepare('SELECT * FROM modifiers ORDER BY sort_order, id').all();
  res.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      items: products
        .filter((p) => p.category_id === c.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          pricePaise: p.price_paise,
          image: p.image,
          emoji: p.emoji,
          modifierGroups: groups
            .filter((g) => g.product_id === p.id || g.product_id === null)
            .map((g) => ({
              id: g.id,
              name: g.name,
              type: g.type,
              required: !!g.required,
              options: mods
                .filter((m) => m.group_id === g.id)
                .map((m) => ({ id: m.id, name: m.name, pricePaise: m.price_paise })),
            })),
        })),
    })),
    business: {
      name: getSetting('business_name'),
      tagline: getSetting('business_tagline'),
      currencySymbol: getSetting('currency_symbol'),
      autoResetSeconds: parseInt(getSetting('auto_reset_seconds'), 10) || 20,
      gstPercent: parseFloat(getSetting('gst_percent')) || 18,
      gstLabel: getSetting('gst_label') || 'GST incl',
    },
    demo: getSetting('demo_mode') === '1',
  });
});

/**
 * Create an order. PAYMENT IS NOT HANDLED HERE — the kiosk payment page is a
 * placeholder for now. When the gateway is integrated, this endpoint will
 * additionally return the gateway session payload (see PHONEPE_INTEGRATION.md).
 */
app.post('/api/orders', (req, res) => {
  try {
    const priced = priceCart(req.body?.cart);
    const orderId = createOrder(priced, req.body?.note);
    const order = getOrder(orderId);
    broadcast({ type: 'order_created', orderId, orderNumber: order.order_number, totalPaise: order.total_paise });
    res.json({
      orderId,
      orderNumber: order.order_number,
      totalPaise: order.total_paise,
      payment: null, // placeholder — gateway integration point
    });
  } catch (err) {
    bad(res, err.status ?? 500, err.clientMessage ?? 'Something went wrong. Your order has NOT been charged. Please try again.', err);
  }
});

// Order status (kiosk payment page polls this)
app.get('/api/orders/:id/status', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) return bad(res, 404, 'Order not found.');
  res.json({
    orderId: o.id,
    orderNumber: o.order_number,
    paymentStatus: o.payment_status,
    orderStatus: o.status,
    totalPaise: o.total_paise,
  });
});

/**
 * DEV-ONLY mark-paid hook — tests the full post-payment flow (order number,
 * receipt print, kitchen slip, auto reset) before the gateway exists.
 * Automatically disabled when PAYMENT_MODE=live.
 */
app.post('/api/dev/pay/:orderId', (req, res) => {
  if (config.paymentMode !== 'test') return bad(res, 403, 'Dev payments are disabled in live mode.');
  const o = getOrder(Number(req.params.orderId));
  if (!o) return bad(res, 404, 'Order not found.');
  const r = markOrderPaid(o.id, { provider: 'test', paymentRef: `dev_${Date.now()}` });
  broadcast({ type: 'order_paid', orderId: o.id, orderNumber: o.order_number });
  res.json({ ok: true, ...r });
});

/**
 * Payment webhook stub — the future gateway (PhonePe) posts confirmed payment
 * events here. It stays OFF until PAYMENT_PROVIDER is set, and always verifies
 * the provider's signature before trusting a payment. See docs/PHONEPE_INTEGRATION.md.
 */
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
  if (config.paymentProvider === 'none') {
    return res.status(503).json({ ok: false, message: 'Payment gateway not configured.' });
  }
  // TODO(gateway): verify signature, then markOrderPaid(orderId, { provider, paymentRef })
  res.status(501).json({ ok: false, message: 'Webhook handler not implemented yet.' });
});

// live updates for admin screens
app.get('/api/events', sseHandler);

// ---------- admin APIs ----------
const admin = express.Router();
/**
 * Kitchen display endpoints (unauthenticated by design — read-only board plus
 * status advance; no payment, settings or customer data are exposed here).
 */
app.get('/api/kitchen/orders', (req, res) => {
  const rows = listOrders({ limit: 40 }).filter(
    (o) => ['new', 'preparing', 'ready'].includes(o.status)
  );
  res.json(rows.map((o) => ({ ...o, items: getOrder(o.id).items })));
});

app.post('/api/kitchen/orders/:id/status', (req, res) => {
  try {
    setOrderStatus(Number(req.params.id), String(req.body?.status));
    broadcast({ type: 'order_status', orderId: Number(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    bad(res, 400, 'Invalid status.');
  }
});

admin.use(requireAdmin);

admin.get('/stats', (req, res) => res.json(todayStats()));

admin.get('/orders', (req, res) => {
  res.json(listOrders({ limit: Number(req.query.limit) || 100, status: req.query.status, q: req.query.q }));
});

admin.get('/orders/:id', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) return bad(res, 404, 'Order not found.');
  res.json(o);
});

admin.get('/orders/:id/receipt', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) return bad(res, 404, 'Order not found.');
  const { blocks, text } = buildReceipt(o);
  res.json({ blocks, text });
});

admin.post('/orders/:id/status', (req, res) => {
  try {
    setOrderStatus(Number(req.params.id), String(req.body?.status));
    broadcast({ type: 'order_status', orderId: Number(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    bad(res, 400, 'Invalid status.');
  }
});

admin.post('/orders/:id/reprint', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) return bad(res, 404, 'Order not found.');
  enqueuePrint(o.id, 'receipt');
  if (getSetting('show_kitchen_slip') !== '0') enqueuePrint(o.id, 'kitchen');
  res.json({ ok: true });
});

admin.get('/print-jobs', (req, res) => {
  res.json(listPrintJobs({ status: req.query.status, limit: Number(req.query.limit) || 100 }));
});
admin.post('/print-jobs/:id/retry', (req, res) => {
  const job = db.prepare('SELECT id FROM print_jobs WHERE id = ?').get(Number(req.params.id));
  if (!job) return bad(res, 404, 'Print job not found.');
  reprintJob(job.id);
  res.json({ ok: true });
});

// --- menu management ---
function menuSnapshot() {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const prods = db.prepare('SELECT * FROM products ORDER BY sort_order, id').all();
  const groups = db.prepare('SELECT * FROM modifier_groups ORDER BY sort_order, id').all();
  const mods = db.prepare('SELECT * FROM modifiers ORDER BY sort_order, id').all();
  return {
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      available: !!c.available,
      items: prods
        .filter((p) => p.category_id === c.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          pricePaise: p.price_paise,
          image: p.image,
          emoji: p.emoji,
          available: !!p.available,
          modifierGroups: groups
            .filter((g) => g.product_id === p.id)
            .map((g) => ({
              id: g.id,
              name: g.name,
              type: g.type,
              required: !!g.required,
              options: mods.filter((m) => m.group_id === g.id).map((m) => ({ id: m.id, name: m.name, pricePaise: m.price_paise })),
            })),
        })),
    })),
  };
}

admin.get('/menu', (req, res) => res.json(menuSnapshot()));

const CAT_FIELDS = ['name', 'emoji', 'available', 'sort_order'];
admin.post('/categories', (req, res) => {
  const { name, emoji = '', available = 1, sort_order = 0 } = req.body ?? {};
  if (!name) return bad(res, 400, 'Name required.');
  const info = db.prepare('INSERT INTO categories (name, emoji, available, sort_order) VALUES (?,?,?,?)')
    .run(String(name).slice(0, 40), String(emoji).slice(0, 8), available ? 1 : 0, Number(sort_order) || 0);
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, id: info.lastInsertRowid, menu: menuSnapshot() });
});
admin.patch('/categories/:id', (req, res) => {
  const body = req.body ?? {};
  const sets = [];
  const args = [];
  for (const f of CAT_FIELDS) {
    if (f in body) {
      sets.push(`${f} = ?`);
      args.push(f === 'available' ? (body[f] ? 1 : 0) : body[f]);
    }
  }
  if (!sets.length) return bad(res, 400, 'Nothing to update.');
  args.push(Number(req.params.id));
  db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});
admin.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});

const PROD_FIELDS = ['category_id', 'name', 'description', 'price_paise', 'image', 'emoji', 'available', 'sort_order'];
admin.post('/products', (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.category_id) return bad(res, 400, 'Name and category required.');
  const info = db.prepare(
    'INSERT INTO products (category_id, name, description, price_paise, image, emoji, available, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    Number(b.category_id),
    String(b.name).slice(0, 80),
    String(b.description ?? '').slice(0, 200),
    Math.max(0, Math.round(Number(b.price_paise) || 0)),
    b.image ? String(b.image).slice(0, 200) : null,
    String(b.emoji ?? '').slice(0, 8),
    b.available === false ? 0 : 1,
    Number(b.sort_order) || 0
  );
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, id: info.lastInsertRowid, menu: menuSnapshot() });
});
admin.patch('/products/:id', (req, res) => {
  const body = req.body ?? {};
  const sets = [];
  const args = [];
  for (const f of PROD_FIELDS) {
    if (f in body) {
      let v = body[f];
      if (f === 'available') v = v ? 1 : 0;
      if (f === 'price_paise') v = Math.max(0, Math.round(Number(v) || 0));
      if (f === 'image') v = v ? String(v).slice(0, 200) : null;
      if (typeof v === 'string') v = v.slice(0, 200);
      sets.push(`${f} = ?`);
      args.push(v);
    }
  }
  if (!sets.length) return bad(res, 400, 'Nothing to update.');
  args.push(Number(req.params.id));
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});
admin.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});

// --- modifier management ---
admin.post('/modifier-groups', (req, res) => {
  const b = req.body ?? {};
  if (!b.name) return bad(res, 400, 'Name required.');
  const info = db.prepare('INSERT INTO modifier_groups (product_id, name, type, required, sort_order) VALUES (?,?,?,?,?)')
    .run(b.productId ? Number(b.productId) : null, String(b.name).slice(0, 60), b.type === 'single' ? 'single' : 'addon', b.required ? 1 : 0, Number(b.sortOrder) || 0);
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, id: info.lastInsertRowid, menu: menuSnapshot() });
});
admin.post('/modifiers', (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.groupId) return bad(res, 400, 'Name and groupId required.');
  const info = db.prepare('INSERT INTO modifiers (group_id, name, price_paise, sort_order) VALUES (?,?,?,?)')
    .run(Number(b.groupId), String(b.name).slice(0, 60), Math.max(0, Math.round(Number(b.pricePaise) || 0)), Number(b.sortOrder) || 0);
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, id: info.lastInsertRowid, menu: menuSnapshot() });
});
admin.delete('/modifier-groups/:id', (req, res) => {
  db.prepare('DELETE FROM modifier_groups WHERE id = ?').run(Number(req.params.id));
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});
admin.delete('/modifiers/:id', (req, res) => {
  db.prepare('DELETE FROM modifiers WHERE id = ?').run(Number(req.params.id));
  broadcast({ type: 'menu_changed' });
  res.json({ ok: true, menu: menuSnapshot() });
});

// --- settings / bill designer ---
admin.get('/settings', (req, res) => res.json(getAllSettings()));
admin.post('/settings', (req, res) => {
  setSettings(req.body ?? {});
  broadcast({ type: 'settings_changed' });
  res.json({ ok: true, settings: getAllSettings() });
});

// Bill designer live preview: renders a sample order (or the latest paid one)
// with the CURRENT settings. Creates no print job.
admin.post('/receipt-preview', (req, res) => {
  const sample = {
    order_number: 1047,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    paid_at: null,
    payment_status: 'paid',
    payment_ref: null,
    subtotal_paise: 39500,
    tax_paise: 2500,
    total_paise: 42000,
    tax_label: 'GST (5%)',
    items: [
      { name: 'Peri Peri Fries', qty: 2, unit_paise: 9900, total_paise: 19800, modifiers: '[]' },
      { name: 'Crispy Jumbo Chicken Roll', qty: 1, unit_paise: 14900, total_paise: 14900, modifiers: '[]' },
      { name: 'Melted Cheese', qty: 1, unit_paise: 2500, total_paise: 2500, modifiers: '[]' },
    ],
  };
  const latest = db.prepare("SELECT id FROM orders WHERE payment_status = 'paid' ORDER BY id DESC LIMIT 1").get();
  let order = sample;
  if (latest) {
    const o = getOrder(latest.id);
    order = { ...sample, ...o, items: o.items };
  }
  const { text } = buildReceipt(order);
  res.json({ text });
});

// --- printer ---
admin.get('/printer', (req, res) => res.json(printerStatus()));
admin.post('/printer/test', (req, res) => {
  const widthChars = parseInt(getSetting('paper_width_chars'), 10) || 32;
  const blocks = [
    { text: 'TEST PRINT', align: 'center', big: true },
    { text: new Date().toLocaleString('en-IN'), align: 'center' },
    { text: 'If you can read this, the printer works.', align: 'center' },
    { text: '-'.repeat(widthChars), align: 'left' },
  ];
  const bytes = buildEscposBytes(blocks, { widthChars });
  import('./services/printer.js')
    .then(({ sendRawToPrinter }) => sendRawToPrinter(bytes))
    .then((r) => res.json({ ok: true, detail: r.detail }))
    .catch((err) => bad(res, 502, 'Printer not reachable. Check connection and try again.', err));
});

app.use('/api/admin', admin);

// --- uploads (menu images + logo) ---
app.post('/api/admin/upload', requireAdmin, express.raw({ type: 'image/*', limit: '5mb' }), (req, res) => {
  const ct = String(req.headers['content-type'] ?? '');
  if (!ct.startsWith('image/')) return bad(res, 400, 'Only images are allowed.');
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
  const name = `img_${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const dir = path.resolve(config.uploadDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), req.body);
  res.json({ ok: true, url: `/uploads/${name}` });
});
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true }));

// ---------- pages ----------
const PUB = path.resolve(config.root, 'public');
app.use(express.static(PUB, { maxAge: config.env === 'production' ? '1h' : 0 }));

app.get('/admin/login', (req, res) => res.sendFile(path.join(PUB, 'admin-login.html')));
app.get('/admin', requireAdminPage, (req, res) => res.sendFile(path.join(PUB, 'admin.html')));
app.get('/admin/', requireAdminPage, (req, res) => res.sendFile(path.join(PUB, 'admin.html')));
app.get('/kitchen', (req, res) => res.sendFile(path.join(PUB, 'kitchen.html')));
app.get('/kitchen/', (req, res) => res.sendFile(path.join(PUB, 'kitchen.html')));

// 404 for API, friendly page otherwise
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: true, message: 'Not found' });
  res.status(404).sendFile(path.join(PUB, '404.html'));
});

// final error handler — customer-friendly, never leaks internals
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: true, message: 'Something went wrong. Please try again.' });
  }
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(config.port, config.host, () => {
  console.log(`Food truck kiosk running at http://localhost:${config.port}`);
  console.log(`  Kiosk:    http://<this-machine-ip>:${config.port}/`);
  console.log(`  Admin:    http://<this-machine-ip>:${config.port}/admin  (PIN 1234 by default)`);
});
