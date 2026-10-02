/**
 * QR service. Matrices come from the `qrcode` package (battle-tested encoder);
 * our contribution is the crisp module-perfect SVG serializer so the kiosk only
 * loads an <img> — the old iPad does zero QR computation.
 */
import QRCode from 'qrcode';

/** Raw matrix {size, modules} for tests/tools. */
export async function qr(text) {
  const qr0 = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
  return { size: qr0.modules.size, modules: qr0.modules };
}

/** Render a crisp SVG string (module-perfect, no blur). */
export async function qrSvg(text, { scale = 8, margin = 2, dark = '#111318', light = '#ffffff' } = {}) {
  const { size, modules } = await qr(text);
  const dim = (size + margin * 2) * scale;
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) {
        rects += `<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
}
