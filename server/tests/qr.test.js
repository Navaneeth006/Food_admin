/**
 * QR tests. The matrices come from the qrcode package, but these tests still
 * verify our SVG serializer round-trips through an independent decoder (jsqr)
 * so a broken/blank QR can never reach the payment screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from 'canvas';
import jsQR from 'jsqr';
import { qrSvg } from '../services/qrcode.js';

async function decodeSvg(svgString) {
  const W = 512;
  const canvas = createCanvas(W, W);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, W);
  const image = await loadImage(Buffer.from(svgString));
  ctx.drawImage(image, 0, 0, W, W);
  const data = ctx.getImageData(0, 0, W, W);
  return jsQR(data.data, W, W);
}

test('qrSvg produces an SVG that decodes to its payload', async () => {
  const t = 'upi://pay?pa=foodtruck@upi&pn=FOOD%20TRUCK&am=420.00&cu=INR&tn=Order%201047';
  const svg = await qrSvg(t);
  assert.ok(svg.startsWith('<svg'));
  const r = await decodeSvg(svg);
  assert.ok(r, 'independent decoder returned no result');
  assert.equal(r.data, t);
});

test('qrSvg handles larger payloads', async () => {
  const t = 'upi://pay?pa=merchant@bank&am=12345.67&cu=INR&tr=TN123&tn=' + 'x'.repeat(120);
  const svg = await qrSvg(t);
  const r = await decodeSvg(svg);
  assert.ok(r, 'independent decoder returned no result');
  assert.equal(r.data, t);
});
