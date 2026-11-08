// Generación y lectura del contenido de los QR.
import qrcode from '../vendor/qrcode.mjs';
import { normPlate } from './util.js';

/** Contenido del QR nuevo: prefijo + token aleatorio de 32 caracteres. */
export const qrPayload = token => 'CP2:' + token;

export function qrMatrix(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}

/** SVG nítido a cualquier tamaño (un único path). */
export function qrSvg(text, { margin = 2, label = 'Código QR del pase' } = {}) {
  const { n, dark } = qrMatrix(text);
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return `<svg class="qr-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0e1424"/></svg>`;
}

/** Interpreta un QR leído: pase nuevo (token) o pase antiguo (JSON con matrícula). */
export function parseQr(raw) {
  raw = String(raw || '').trim();
  const m = /^CP2[^A-Za-z0-9]{0,2}([a-f0-9]{32})$/i.exec(raw); // lectores con teclado español cambian «:» por «Ñ»
  if (m) return { token: m[1].toLowerCase() };
  try {
    const o = JSON.parse(raw);
    if (o && o.plate) return { plate: normPlate(o.plate), legacy: true };
  } catch { /* no es JSON */ }
  return null;
}
