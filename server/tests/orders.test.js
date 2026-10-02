/**
 * Order engine tests: server-side pricing, validation, sequential order
 * numbers, receipt blocks and kitchen-slip generation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database.js';

test('priceCart rejects an empty cart', async () => {
  const { priceCart } = await import('../services/orders.js');
  assert.throws(() => priceCart([]), /Cart is empty/);
});

test('order numbers are sequential and unique', async () => {
  const { db: d } = await import('../db/database.js');
  const { nextOrderNumber } = await import('../db/database.js');
  const a = nextOrderNumber();
  const b = nextOrderNumber();
  assert.equal(b, a + 1);
});

test('createOrder persists items and assigns an order number', async () => {
  const { priceCart, createOrder, getOrder } = await import('../services/orders.js');
  // create a temp product
  const cat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run('TESTCAT', '🧪');
  const prod = db.prepare('INSERT INTO products (category_id, name, price_paise) VALUES (?, ?, ?)')
    .run(cat.lastInsertRowid, 'Test Item', 12345);
  const priced = priceCart([{ productId: prod.lastInsertRowid, qty: 2, modifierIds: [] }]);
  assert.equal(priced.lines[0].name, 'Test Item');
  assert.equal(priced.total_paise, 29134);
  const orderId = createOrder(priced, 'test note');
  const order = getOrder(orderId);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].qty, 2);
  assert.ok(order.order_number > 0);
  // cleanup
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(prod.lastInsertRowid);
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.lastInsertRowid);
});

test('receipt includes order number and total without a kitchen slip', async () => {
  const { buildReceipt } = await import('../services/receipt.js');
  const receipt = buildReceipt({
    order_number: 1047,
    created_at: '2026-09-22 20:32:00',
    payment_status: 'paid',
    subtotal_paise: 39500,
    tax_paise: 2500,
    total_paise: 42000,
    tax_label: 'GST (5%)',
    items: [
      { name: 'Peri Peri Fries', qty: 2, unit_paise: 9900, total_paise: 19800, modifiers: '[]' },
      { name: 'Melted Cheese', qty: 1, unit_paise: 2500, total_paise: 2500, modifiers: '[]' },
    ],
  });
  assert.ok(receipt.text.includes('#1047'));
  assert.ok(receipt.text.includes('TOTAL'));
  assert.ok(!receipt.text.includes('KITCHEN SLIP'));
});

test('default kiosk settings disable kitchen slips and include 18% GST', async () => {
  const { getSetting } = await import('../db/database.js');
  const { priceCart } = await import('../services/orders.js');
  assert.equal(getSetting('show_kitchen_slip'), '0');

  const cat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run('GSTTEST', '🧪');
  const prod = db.prepare('INSERT INTO products (category_id, name, price_paise) VALUES (?, ?, ?)')
    .run(cat.lastInsertRowid, 'GST Test Item', 10000);

  const priced = priceCart([{ productId: prod.lastInsertRowid, qty: 1, modifierIds: [] }]);
  assert.equal(priced.tax_paise, 1800);
  assert.equal(priced.total_paise, 11800);

  db.prepare('DELETE FROM products WHERE id = ?').run(prod.lastInsertRowid);
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.lastInsertRowid);
});

test('orders are created awaiting payment and marked paid via the test hook', async () => {
  const { priceCart, createOrder, getOrder } = await import('../services/orders.js');
  const cat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run('PAYTEST', '🧪');
  const prod = db.prepare('INSERT INTO products (category_id, name, price_paise) VALUES (?, ?, ?)')
    .run(cat.lastInsertRowid, 'Pay Test Item', 42000);

  const priced = priceCart([{ productId: prod.lastInsertRowid, qty: 1, modifierIds: [] }]);
  const orderId = createOrder(priced, 'payment hook test');
  let order = getOrder(orderId);
  assert.equal(order.payment_status, 'pending');
  assert.equal(order.status, 'awaiting_payment');

  const { markOrderPaid } = await import('../services/printer.js');
  const paid = markOrderPaid(orderId, { provider: 'test' });
  assert.equal(paid.already, false);
  assert.equal(paid.orderNumber, order.order_number);
  order = getOrder(orderId);
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.status, 'new');
  // idempotent: second call must not double-print or error
  const again = markOrderPaid(orderId, { provider: 'test' });
  assert.equal(again.already, true);

  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(prod.lastInsertRowid);
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.lastInsertRowid);
});
