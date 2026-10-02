import { db, getSetting, nextOrderNumber } from '../db/database.js';

const MAX_QTY_DEFAULT = 10;

function getIntSetting(key, fallback) {
  const v = parseInt(getSetting(key) ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

const roundPaise = (p) => Math.round(p);

/**
 * Price a cart server-side. The client's numbers are NEVER trusted: every
 * unit price and modifier price is re-read from the database here.
 * cart = [{ productId, qty, modifierIds: [id, ...] }]
 */
export function priceCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw Object.assign(new Error('Cart is empty'), { status: 400, clientMessage: 'Your cart is empty. Please add some items first.' });
  }
  if (cart.length > 60) {
    throw Object.assign(new Error('Cart too large'), { status: 400, clientMessage: 'That is too many items for one order.' });
  }
  const maxQty = getIntSetting('max_qty_per_item', MAX_QTY_DEFAULT);

  const getProduct = db.prepare(`
    SELECT p.id, p.name, p.price_paise, p.available, c.available AS cat_available
    FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?`);
  const getMods = db.prepare(`
    SELECT m.id, m.name, m.price_paise
    FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id
    WHERE m.id = ? AND (g.product_id IS NULL OR g.product_id = ?)`);

  const lines = [];
  let subtotal = 0;

  for (const entry of cart) {
    const productId = Number(entry.productId);
    const qty = Math.floor(Number(entry.qty));
    if (!Number.isInteger(productId) || productId <= 0) {
      throw Object.assign(new Error('Bad product id'), { status: 400, clientMessage: 'One of the items is no longer on the menu. Please start a new order.' });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
      throw Object.assign(new Error('Bad quantity'), { status: 400, clientMessage: 'Item quantity is out of range. Please adjust and try again.' });
    }
    const p = getProduct.get(productId);
    if (!p || !p.available || !p.cat_available) {
      throw Object.assign(new Error('Product unavailable'), { status: 409, clientMessage: 'Sorry, one of the items just sold out. Please review your order.' });
    }

    // de-duplicate modifier ids, validate each belongs to this product
    const modIds = [...new Set((Array.isArray(entry.modifierIds) ? entry.modifierIds : []).map(Number))];
    const mods = [];
    let modSum = 0;
    for (const id of modIds) {
      const m = getMods.get(id, productId);
      if (!m) continue;
      mods.push({ name: m.name, price_paise: m.price_paise });
      modSum += m.price_paise;
    }
    if (mods.length > 8) {
      throw Object.assign(new Error('Too many modifiers'), { status: 400, clientMessage: 'Too many extras on one item.' });
    }

    const unit = p.price_paise + modSum;
    const lineTotal = roundPaise(unit * qty);
    subtotal += lineTotal;
    lines.push({
      productId: p.id,
      name: p.name,
      unit_paise: unit,
      qty,
      total_paise: lineTotal,
      modifiers: mods,
    });
  }

  if (lines.length === 0) {
    throw Object.assign(new Error('Cart resolved empty'), { status: 400, clientMessage: 'Your cart is empty. Please add some items first.' });
  }

  subtotal = roundPaise(subtotal);
  const gstPercent = Math.max(0, Math.min(40, Number(getSetting('gst_percent')) || 18));
  const showGst = getSetting('show_gst_on_receipt') !== '0' && gstPercent > 0;
  const tax = showGst ? roundPaise((subtotal * gstPercent) / 100) : 0;
  const total = subtotal + tax;

  return {
    lines,
    subtotal_paise: subtotal,
    tax_paise: tax,
    total_paise: total,
    tax_label: showGst ? `${getSetting('gst_label') || 'GST incl'} (${gstPercent}%)` : '',
    currency: 'INR',
  };
}

/**
 * Create an order atomically: sequential order number assignment and row
 * insert happen inside one transaction so two kiosks can never collide.
 * status: 'awaiting_payment' until payment verifies.
 */
export const createOrder = db.transaction((priced, note = '') => {
  const orderNumber = nextOrderNumber();
  const info = db
    .prepare(
      `INSERT INTO orders (order_number, status, payment_status, subtotal_paise, tax_paise,
                           total_paise, tax_label, currency, note)
       VALUES (?, 'awaiting_payment', 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderNumber,
      priced.subtotal_paise,
      priced.tax_paise,
      priced.total_paise,
      priced.tax_label,
      priced.currency,
      String(note ?? '').slice(0, 300)
    );
  const orderId = info.lastInsertRowid;
  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, unit_paise, qty, total_paise, modifiers)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of priced.lines) {
    insItem.run(orderId, l.productId ?? null, l.name, l.unit_paise, l.qty, l.total_paise, JSON.stringify(l.modifiers ?? []));
  }
  return orderId;
});

export function getOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  return order;
}

export function getOrderByNumber(orderNumber) {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  return order;
}

export function setOrderStatus(orderId, status) {
  const allowed = ['new', 'preparing', 'ready', 'completed', 'cancelled'];
  if (!allowed.includes(status)) throw new Error('bad status');
  db.prepare(`UPDATE orders SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END WHERE id = ?`).run(status, status, orderId);
}

export function listOrders({ limit = 100, status, q } = {}) {
  let sql = 'SELECT * FROM orders';
  const wh = [];
  const args = [];
  if (status) { wh.push('status = ?'); args.push(status); }
  if (q) {
    wh.push('(CAST(order_number AS TEXT) LIKE ? OR payment_ref LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  if (wh.length) sql += ' WHERE ' + wh.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ?';
  args.push(Math.min(500, Math.max(1, limit)));
  const rows = db.prepare(sql).all(...args);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  for (const r of rows) r.items = items.all(r.id);
  return rows;
}

export function todayStats() {
  const day = db.prepare(`SELECT * FROM orders WHERE date(created_at) = date('now','localtime')`).all();
  const paid = day.filter((o) => o.payment_status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.total_paise, 0);
  const aov = paid.length ? Math.round(revenue / paid.length) : 0;
  return {
    orders: day.length,
    paid: paid.length,
    pending: day.filter((o) => o.payment_status === 'pending' && o.status !== 'cancelled').length,
    completed: day.filter((o) => o.status === 'completed').length,
    revenue_paise: revenue,
    avg_order_paise: aov,
  };
}
