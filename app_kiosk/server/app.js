import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../public');

const PORT = 4242;
const HOST = '0.0.0.0';

app.use(express.json());

const menu = [
  { id: 1, name: 'Burger', price: 120, category: 'Main' },
  { id: 2, name: 'Fries', price: 80, category: 'Sides' },
  { id: 3, name: 'Cold Coffee', price: 90, category: 'Drinks' },
  { id: 4, name: 'Pizza Slice', price: 150, category: 'Main' }
];

const orders = [];

function nextOrderId() {
  return orders.reduce((highest, order) => Math.max(highest, Number(order.id) || 0), 0) + 1;
}

app.get('/api/menu', (req, res) => {
  res.json({ menu });
});

app.post('/api/orders', (req, res) => {
  const { cart, customerName } = req.body || {};
  if (!Array.isArray(cart) || cart.length === 0) {
    res.status(400).json({ error: 'Cart is empty' });
    return;
  }

  const items = [];
  for (const requested of cart) {
    const menuItem = menu.find((item) => item.id === Number(requested?.id));
    const quantity = Number(requested?.qty);
    if (!menuItem || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      res.status(400).json({ error: 'Invalid menu item or quantity' });
      return;
    }
    items.push({ ...menuItem, qty: quantity });
  }

  const id = nextOrderId();
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const order = {
    id,
    tokenNumber: id + 100,
    customerName: customerName || 'Walk-in',
    items,
    total,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    paymentMethod: null,
    printStatus: 'not-configured'
  };

  orders.push(order);

  res.json({ ok: true, order });
});

app.post('/api/admin/orders/:id/mark-paid', (req, res) => {
  const order = orders.find((item) => item.id === Number(req.params.id));
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (!['cash', 'upi'].includes(req.query.method)) {
    res.status(400).json({ error: 'Payment method must be cash or upi' });
    return;
  }
  if (order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    order.paymentMethod = req.query.method;
    order.status = 'new';
    order.paidAt = Date.now();
  }
  res.json({ ok: true, order });
});

app.get('/api/orders', (req, res) => {
  res.json({ orders });
});

app.get('/api/admin/orders', (req, res) => {
  res.json({ orders: orders.slice().reverse() });
});

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body || {};
  if (pin === '1234') {
    res.json({ ok: true, message: 'Admin logged in' });
    return;
  }

  res.status(401).json({ ok: false, message: 'Invalid PIN' });
});

app.get('/api/admin/stats', (req, res) => {
  const paidOrders = orders.filter((order) => order.paymentStatus === 'paid');
  const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  res.json({
    orders: orders.length,
    totalRevenue,
    pending: orders.filter((order) => order.paymentStatus === 'pending').length
  });
});

app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'connect.html'));
});

app.get('/kiosk.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'kiosk.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Phone server running at http://localhost:${PORT}`);
  console.log(`Connect page: http://<phone-ip>:${PORT}/`);
  console.log(`iPad kiosk URL: http://<phone-ip>:${PORT}/kiosk.html`);
  console.log(`Admin URL: http://<phone-ip>:${PORT}/admin.html`);
});
