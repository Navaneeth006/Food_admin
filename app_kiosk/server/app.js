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
app.use('/api/admin', (req, res, next) => {
  if (req.get('origin') !== 'https://localhost') {
    res.status(403).json({ error: 'Admin controls are available in the Food Kiosk app only.' });
    return;
  }
  next();
});

const menu = [
  { id: 1, name: 'Burger', price: 120, category: 'Main', featured: true },
  { id: 2, name: 'Fries', price: 80, category: 'Sides', featured: true },
  { id: 3, name: 'Cold Coffee', price: 90, category: 'Drinks', featured: true },
  { id: 4, name: 'Pizza Slice', price: 150, category: 'Main', featured: true }
];

const orders = [];

function nextOrderId() {
  return orders.reduce((highest, order) => Math.max(highest, Number(order.id) || 0), 0) + 1;
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
    status: 'new',
    paymentStatus: 'pending',
    paymentMethod: null,
    printStatus: 'not-configured',
    billPrintStatus: 'not-configured',
    tokenPrintStatus: 'not-configured',
    createdAt: Date.now()
  };

  orders.push(order);

  res.json({ ok: true, order });
});

app.get('/api/orders/:id/status', (req, res) => {
  const order = orders.find((item) => item.id === Number(req.params.id));
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  res.json({
    orderId: order.id,
    tokenNumber: order.tokenNumber,
    billPrintStatus: order.billPrintStatus,
    tokenPrintStatus: order.tokenPrintStatus,
    printStatus: order.printStatus
  });
});

app.get('/api/orders', (req, res) => {
  res.json({ orders });
});

app.get('/api/admin/orders', (req, res) => {
  res.json({ orders: orders.slice().reverse() });
});

app.get('/api/admin/stats', (req, res) => {
  const paidOrders = orders.filter((order) => order.paymentStatus === 'paid');
  const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const daily = {};
  const today = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = localDayKey(date);
    daily[key] = { date: key, orders: 0, paidOrders: 0, revenue: 0 };
  }
  for (const order of orders) {
    const key = localDayKey(new Date(Number(order.createdAt) || 0));
    const day = daily[key];
    if (!day) continue;
    day.orders += 1;
    if (order.paymentStatus === 'paid') {
      day.paidOrders += 1;
      day.revenue += Number(order.total) || 0;
    }
  }
  res.json({
    orders: orders.length,
    totalRevenue,
    pending: orders.filter((order) => order.paymentStatus === 'pending').length,
    daily
  });
});

app.get(['/admin.html', '/index.html'], (_req, res) => {
  res.status(404).send('Admin controls are available in the Food Kiosk app only.');
});

app.use(express.static(publicDir, { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'connect.html'));
});

app.get('/kiosk.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'kiosk.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Phone server running at http://localhost:${PORT}`);
  console.log(`Connect page: http://<phone-ip>:${PORT}/`);
  console.log(`iPad kiosk URL: http://<phone-ip>:${PORT}/kiosk.html`);
});
