/**
 * Receipt model: renders an order into a structured block model that both the
 * ESC/POS builder and the admin bill designer's live preview consume.
 * All values come from the settings table — nothing is hard-coded.
 */
import { getAllSettings, getSetting } from '../db/database.js';

const W = () => parseInt(getSetting('paper_width_chars') ?? '32', 10) || 32;

export function money(paise) {
  const symbol = getSetting('currency_symbol') || '₹';
  const v = (paise / 100).toFixed(2).replace(/\.00$/, '');
  return `${symbol}${v}`;
}

function center(text, w) {
  const t = text.slice(0, w);
  const pad = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(pad) + t;
}
function row(left, right, w) {
  left = String(left);
  right = String(right);
  const space = w - left.length - right.length;
  if (space < 1) return (left + ' ' + right).slice(0, w);
  return left + ' '.repeat(space) + right;
}
const hr = (w) => '─'.repeat(w);

/**
 * Build the receipt (customer bill + optional kitchen slip) as text blocks.
 * Returns { blocks: [{text, align, big}], text }
 */
export function buildReceipt(order) {
  const s = getAllSettings();
  const w = W();
  const fontScale = Math.max(0.8, Math.min(1.5, parseFloat(s.receipt_font_scale) || 1));
  const align = s.receipt_align === 'left' ? 'left' : 'center';
  const blocks = [];

  const headerLines = String(s.receipt_header_lines || '').split('\n').filter(Boolean);
  blocks.push({ text: s.business_name || 'FOOD TRUCK', align, big: true });
  for (const l of headerLines) blocks.push({ text: l, align });
  if (s.show_address !== '0' && s.address) blocks.push({ text: s.address, align });
  if (s.show_phone !== '0' && s.phone) blocks.push({ text: `Ph: ${s.phone}`, align });
  if (s.gst_number) blocks.push({ text: `GSTIN: ${s.gst_number}`, align });
  blocks.push({ text: hr(w), align: 'left' });

  blocks.push({ text: `ORDER #${s.order_prefix || ''}${order.order_number}`, align: 'left', big: true });

  const d = new Date((order.paid_at ?? order.created_at) + 'Z');
  const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  blocks.push({ text: `${dateStr}  ${timeStr}`, align: 'left' });
  blocks.push({ text: hr(w), align: 'left' });

  for (const it of order.items) {
    blocks.push({ text: row(`${it.name} x${it.qty}`, money(it.total_paise), w), align: 'left' });
    for (const m of it.modifiers ? JSON.parse(it.modifiers) : []) {
      blocks.push({ text: row(`  + ${m.name}`, m.price_paise ? money(m.price_paise) : '', w), align: 'left' });
    }
  }
  blocks.push({ text: hr(w), align: 'left' });

  blocks.push({ text: row('Subtotal', money(order.subtotal_paise), w), align: 'left' });
  if (order.tax_paise > 0 && order.tax_label) {
    blocks.push({ text: row(order.tax_label, money(order.tax_paise), w), align: 'left' });
  }
  blocks.push({ text: row('TOTAL', money(order.total_paise), w), align: 'left', big: true });
  blocks.push({ text: row('PAYMENT: ' + (order.payment_status || '').toUpperCase(), '', w), align: 'left' });
  if (order.payment_ref) blocks.push({ text: `Ref: ${order.payment_ref}`, align: 'left' });

  blocks.push({ text: hr(w), align: 'left' });
  if (s.receipt_footer) blocks.push({ text: s.receipt_footer, align });
  if (s.thank_you_message && s.thank_you_message !== s.receipt_footer) {
    blocks.push({ text: s.thank_you_message, align });
  }

  // Kitchen slips are intentionally disabled for the kiosk flow.
  // This remains in the print pipeline for historical compatibility, but it is
  // never rendered by default in the current product configuration.

  const text = blocks.map((b) => b.text).join('\n');
  return { blocks, text, fontScale };
}
