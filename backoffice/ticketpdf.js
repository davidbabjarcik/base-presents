// PDF tickets: one page per ticket, phone-shaped, designed in BASE Hub → Ticket design.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const font = (pkg, file) => require.resolve(`@expo-google-fonts/${pkg}/${file}`);
const FONTS = {
  head: font('montserrat', '700Bold/Montserrat_700Bold.ttf'),
  semi: font('montserrat', '600SemiBold/Montserrat_600SemiBold.ttf'),
  body: font('inter', '400Regular/Inter_400Regular.ttf'),
  medium: font('inter', '500Medium/Inter_500Medium.ttf'),
  mono: font('jetbrains-mono', '400Regular/JetBrainsMono_400Regular.ttf')
};

export const DEFAULT_DESIGN = {
  theme: 'dark',          // dark | light
  layout: 'banner',       // banner (image on top) | background (image behind everything) | none
  overlay: 60,            // % darkening of the background image
  headline: '',           // empty = event name
  tagline: 'We create emotions.',
  info: '18+ · Bring your ID · No re-entry',
  terms: 'One ticket = one entry. The QR code is checked at the door and works only once, so do not share it. Tickets are non-refundable unless the event is cancelled.',
  showPrice: true
};

const W = 360, H = 760, M = 28; // page size in points (phone shape) and side margin
const BANNER = 200;             // height of the image on top
const STUB = 150;               // height of the tear-off part at the bottom

export function createTicketPdf({ assetsDir, uploadsDir }) {
  const logo = { dark: path.join(assetsDir, 'base-logo-white.png'), light: path.join(assetsDir, 'base-logo-black.png') };

  function artworkPath() {
    for (const ext of ['jpg', 'png']) {
      const p = path.join(uploadsDir, `ticket-art.${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // Draw a QR code as vector squares (sharp at any zoom, scans well)
  function drawQr(doc, text, x, y, size, color) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const cell = size / n;
    doc.save().fillColor(color);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.15, cell + 0.15);
      }
    }
    doc.fill().restore();
  }

  function label(doc, text, x, y, color, width) {
    doc.font('mono').fontSize(6.5).fillColor(color).text(text.toUpperCase(), x, y, { characterSpacing: 1.4, width, lineBreak: false });
  }

  function page(doc, d, t, i, total, event, order) {
    const dark = d.theme !== 'light';
    const bg = dark ? '#000000' : '#FFFFFF';
    const fg = dark ? '#FFFFFF' : '#000000';
    const muted = dark ? '#A3A3A3' : '#5C5C5C';
    const line = dark ? '#333333' : '#D4D4D4';
    const art = d.layout !== 'none' ? artworkPath() : null;

    doc.rect(0, 0, W, H).fill(bg);
    let y = M;

    if (art && d.layout === 'background') {
      doc.save();
      doc.rect(0, 0, W, H).clip();
      doc.image(art, 0, 0, { cover: [W, H], align: 'center', valign: 'center' });
      doc.restore();
      doc.save().fillColor(bg).fillOpacity(Math.min(0.95, Math.max(0, d.overlay / 100))).rect(0, 0, W, H).fill().restore();
    }
    if (art && d.layout === 'banner') {
      doc.save();
      doc.rect(0, 0, W, BANNER).clip();
      doc.image(art, 0, 0, { cover: [W, BANNER], align: 'center', valign: 'center' });
      doc.restore();
      y = BANNER + 22;
    }

    // Logo + PRESENTS
    doc.image(logo[dark ? 'dark' : 'light'], M, y, { width: 92 });
    label(doc, 'Presents', M + 104, y + 10, muted, 100);
    label(doc, `Ticket ${i + 1}/${total}`, W - M - 90, y + 10, muted, 90);
    doc.text('', 0, 0); // reset text flow
    y += 46;

    // Headline (event name) — shrink long names to fit two lines
    const headline = (d.headline || event.name).toUpperCase();
    let size = 34;
    doc.font('head');
    while (size > 18 && doc.fontSize(size).heightOfString(headline, { width: W - 2 * M, lineGap: -4 }) > size * 2.1) size -= 2;
    doc.fillColor(fg).fontSize(size).text(headline, M, y, { width: W - 2 * M, lineGap: -4 });
    y = doc.y + 4;
    if (d.tagline) {
      doc.font('body').fontSize(10).fillColor(muted).text(d.tagline, M, y, { width: W - 2 * M });
      y = doc.y + 10;
    } else y += 8;

    // Info grid
    const [datePart, timePart] = String(event.date).split('·').map((s) => s.trim());
    const cols = [['Date', datePart || event.date], ['Start', timePart || '—'], ['Venue', event.venue]];
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(line).stroke();
    y += 10;
    const colW = [(W - 2 * M) * 0.3, (W - 2 * M) * 0.2, (W - 2 * M) * 0.5];
    let x = M;
    cols.forEach(([k, v], c) => {
      label(doc, k, x, y, muted, colW[c] - 6);
      doc.font('medium').fontSize(10).fillColor(fg).text(v, x, y + 11, { width: colW[c] - 6 });
      x += colW[c];
    });
    y += 40;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(line).stroke();
    y += 10;
    label(doc, 'Name', M, y, muted, 150);
    label(doc, event.ticketName, W / 2, y, muted, W / 2 - M);
    doc.font('medium').fontSize(10).fillColor(fg).text(t.holder, M, y + 11, { width: W / 2 - M - 6, height: 14, ellipsis: true });
    doc.text(d.showPrice ? (event.priceCents / 100).toFixed(2).replace('.', ',') + ' €' : 'Entry', W / 2, y + 11, { width: W / 2 - M });
    y += 36;

    // QR on a white tile (also on the light theme, with a thin frame)
    // QR as big as the free space allows
    const qrBox = Math.max(140, Math.min(220, H - STUB - y - 44));
    const qx = (W - qrBox) / 2;
    doc.save().rect(qx, y, qrBox, qrBox).fill('#FFFFFF').restore();
    if (!dark) doc.rect(qx, y, qrBox, qrBox).lineWidth(0.8).strokeColor('#000000').stroke();
    drawQr(doc, t.code, qx + 10, y + 10, qrBox - 20, '#000000');
    y += qrBox + 8;
    doc.font('mono').fontSize(13).fillColor(fg).text(t.code, M, y, { width: W - 2 * M, align: 'center', characterSpacing: 2 });
    y = doc.y + 10;

    // Perforation with side notches
    const py = Math.max(y, H - STUB);
    doc.circle(0, py, 9).fill(dark ? '#262626' : '#E5E5E5');
    doc.circle(W, py, 9).fill(dark ? '#262626' : '#E5E5E5');
    doc.moveTo(16, py).lineTo(W - 16, py).dash(3, { space: 3 }).lineWidth(0.8).strokeColor(line).stroke().undash();

    // Stub: info + terms
    let sy = py + 14;
    if (d.info) {
      doc.font('medium').fontSize(9).fillColor(fg).text(d.info, M, sy, { width: W - 2 * M });
      sy = doc.y + 6;
    }
    if (d.terms) doc.font('body').fontSize(6.5).fillColor(muted).text(d.terms, M, sy, { width: W - 2 * M, lineGap: 1, height: H - sy - 26, ellipsis: true });
    label(doc, `Order ${order.id} · basepresents`, M, H - 20, muted, W - 2 * M);
  }

  // Build the PDF and resolve with a Buffer
  return function render({ design, event, order, tickets, total }) {
    const d = { ...DEFAULT_DESIGN, ...(design || {}) };
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: `${event.name} — tickets`, Author: 'Base Presents' } });
      for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, file);
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      tickets.forEach((t, i) => {
        doc.addPage({ size: [W, H], margin: 0 });
        page(doc, d, t, t.index ?? i, total || tickets.length, event, order);
      });
      doc.end();
    });
  };
}
