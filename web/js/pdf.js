// Pase en PDF (tamaño tarjeta, 54 × 86 mm) con QR vectorial: se imprime nítido a cualquier escala.
// No incluye DNI ni teléfono: si el pase se pierde, no expone datos personales.
import { loadScript, formatPlate } from './util.js';
import { qrMatrix, qrPayload } from './qr.js';

let logoData = null;
async function logo() {
  if (logoData !== null) return logoData;
  try {
    const blob = await (await fetch('icons/logo.jpg')).blob();
    logoData = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  } catch { logoData = ''; }
  return logoData;
}

export async function downloadPassPdf(pass) {
  await loadScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const W = 54, H = 86;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] });
  const blue = [82, 113, 255], ink = [14, 20, 36], grey = [96, 104, 120];

  // Cabecera
  doc.setFillColor(...blue);
  doc.rect(0, 0, W, 15, 'F');
  const img = await logo();
  if (img) doc.addImage(img, 'JPEG', 3.5, 2.5, 10, 10);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(String(pass.eventName || 'ControlPark').slice(0, 24), 16, 7.2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.text('Pase de aparcamiento', 16, 11.4);

  // QR vectorial
  const { n, dark } = qrMatrix(qrPayload(pass.token));
  const qrSize = 36, qx = (W - qrSize) / 2, qy = 18.5, cell = qrSize / n;
  doc.setFillColor(...ink);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (dark(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.02, cell + 0.02, 'F');
  }

  // Matrícula con banda azul
  const py = 58, ph = 9, px = 5, pw = W - 10;
  doc.setDrawColor(...ink); doc.setLineWidth(0.35); doc.setFillColor(255, 255, 255);
  doc.roundedRect(px, py, pw, ph, 1.2, 1.2, 'FD');
  doc.setFillColor(0, 51, 153);
  doc.rect(px + 0.2, py + 0.2, 5, ph - 0.4, 'F');
  doc.setFillColor(255, 204, 0); // círculo de estrellas de la UE, simplificado
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    doc.circle(px + 2.6 + Math.cos(a) * 1.35, py + 3.1 + Math.sin(a) * 1.35, 0.22, 'F');
  }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
  doc.text('E', px + 2.5, py + 7.3, { align: 'center' });
  doc.setTextColor(...ink); doc.setFontSize(14);
  doc.text(formatPlate(pass.plate), px + 5 + (pw - 5) / 2, py + 6.6, { align: 'center' });

  // Datos
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...ink);
  const name = `${pass.nombre} ${pass.apellidos}`.trim();
  doc.text(name.length > 30 ? name.slice(0, 29) + '…' : name, W / 2, 72.5, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...grey);
  doc.text(`Zona ${pass.zonaName || ''}`, W / 2, 76.5, { align: 'center' });
  const car = [pass.marca, pass.modelo].filter(Boolean).join(' ');
  if (car) doc.text(car.slice(0, 34), W / 2, 79.8, { align: 'center' });

  // Pie
  doc.setFillColor(...blue);
  doc.rect(0, H - 4, W, 4, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(4.6);
  doc.text('Enséñalo en la entrada y en la salida', W / 2, H - 1.4, { align: 'center' });

  doc.save(`Pase_${pass.plate}.pdf`);
}
