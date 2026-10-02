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

app.get('/api/menu', (req, res) => {
  res.json({ menu });
});

app.post('/api/orders', (req, res) => {
  const { cart, customerName } = req.body || {};
  const total = (cart || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);

  const order = {
    id: orders.length + 1,
    customerName: customerName || 'Walk-in',
    items: cart || [],
    total,
    status: 'new'
  };

  orders.push(order);

  res.json({ ok: true, order });
});

app.get('/api/orders', (req, res) => {
  res.json({ orders });
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
  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  res.json({
    orders: orders.length,
    totalRevenue,
    pending: orders.filter((order) => order.status !== 'done').length
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
