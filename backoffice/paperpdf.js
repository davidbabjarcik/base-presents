// Printable A4 sheets with paper tickets: 2 × 5 per page, white (ink friendly), dashed cut lines.
import path from 'node:path';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const font = (pkg, file) => require.resolve(`@expo-google-fonts/${pkg}/${file}`);
const FONTS = {
  head: font('montserrat', '700Bold/Montserrat_700Bold.ttf'),
  body: font('inter', '400Regular/Inter_400Regular.ttf'),
  medium: font('inter', '500Medium/Inter_500Medium.ttf'),
  mono: font('jetbrains-mono', '400Regular/JetBrainsMono_400Regular.ttf'),
  monoMid: font('jetbrains-mono', '500Medium/JetBrainsMono_500Medium.ttf')
};

const A4 = [595.28, 841.89];
const COLS = 2, ROWS = 5;
const MARGIN = 18;                                   // page margin (most printers cannot print to the edge)
const TW = (A4[0] - 2 * MARGIN) / COLS;              // ticket width  ≈ 279.6 pt (98.6 mm)
const TH = (A4[1] - 2 * MARGIN) / ROWS;              // ticket height ≈ 161.2 pt (56.9 mm)
const PER_PAGE = COLS * ROWS;

export function createPaperPdf({ assetsDir }) {
  const logo = path.join(assetsDir, 'base-logo-black.png');

  function qr(doc, text, x, y, size) {
    const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = q.modules.size, cell = size / n;
    doc.save().fillColor('#000000');
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.1, cell + 0.1);
    doc.fill().restore();
  }

  function ticket(doc, x, y, t, event, batch) {
    const pad = 12;
    const qrSize = 96;                                // ≈ 34 mm, scans easily from a phone
    const qx = x + TW - pad - qrSize;
    const qy = y + (TH - qrSize - 16) / 2;
    const textW = qx - x - 2 * pad;
    const serial = '#' + String(t.serial).padStart(4, '0');
    const kind = batch.kind === 'door' ? 'DOOR' : 'PRESALE';
    const price = (batch.price_cents / 100).toFixed(2).replace('.', ',') + ' €';
    const [datePart, timePart] = String(event.date).split('·').map((s) => s.trim());

    // Left: brand, event, info
    doc.image(logo, x + pad, y + pad, { width: 58 });
    doc.font('mono').fontSize(5.5).fillColor('#5C5C5C').text('PRESENTS', x + pad + 64, y + pad + 5, { characterSpacing: 1.2, lineBreak: false });
    let ty = y + pad + 26;
    // Event name on one line: shrink the font until it fits
    const name = event.name.toUpperCase();
    let fs = 18;
    doc.font('head');
    while (fs > 10 && doc.fontSize(fs).widthOfString(name) > textW) fs -= 0.5;
    doc.fillColor('#000000').fontSize(fs).text(name, x + pad, ty, { width: textW, lineBreak: false });
    doc.y = ty + fs + 2;
    ty = doc.y + 2;
    doc.font('medium').fontSize(7.5).fillColor('#000000')
      .text([datePart, timePart && 'Start ' + timePart].filter(Boolean).join(' · '), x + pad, ty, { width: textW });
    doc.font('body').fontSize(7).fillColor('#5C5C5C').text(event.venue, x + pad, doc.y + 1, { width: textW, height: 10, ellipsis: true });

    // Kind + price box
    const by = y + TH - pad - 40;
    doc.rect(x + pad, by, textW, 22).fill('#000000');
    doc.font('monoMid').fontSize(6.5).fillColor('#FFFFFF').text(kind, x + pad + 6, by + 8, { characterSpacing: 0.8, width: textW - 60, lineBreak: false });
    doc.font('head').fontSize(11).fillColor('#FFFFFF').text(price, x + pad, by + 5, { width: textW - 6, align: 'right', lineBreak: false });
    doc.font('body').fontSize(5.2).fillColor('#5C5C5C')
      .text('Valid only when sold by Base Presents. One entry, QR checked at the door.', x + pad, by + 25, { width: textW, height: 14, lineGap: 0.5 });

    // Right: QR + serial
    qr(doc, t.code, qx, qy, qrSize);
    doc.font('monoMid').fontSize(12).fillColor('#000000').text(serial, qx, qy + qrSize + 3, { width: qrSize, align: 'center', lineBreak: false });
  }

  function cutLines(doc) {
    doc.save().lineWidth(0.4).strokeColor('#9A9A9A').dash(3, { space: 3 });
    for (let c = 0; c <= COLS; c++) doc.moveTo(MARGIN + c * TW, MARGIN - 8).lineTo(MARGIN + c * TW, A4[1] - MARGIN + 8).stroke();
    for (let r = 0; r <= ROWS; r++) doc.moveTo(MARGIN - 8, MARGIN + r * TH).lineTo(A4[0] - MARGIN + 8, MARGIN + r * TH).stroke();
    doc.undash().restore();
  }

  return function render({ event, batch, tickets }) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: A4, margin: 0, autoFirstPage: false, info: { Title: `${event.name} — printed tickets`, Author: 'Base Presents' } });
      for (const [n, f] of Object.entries(FONTS)) doc.registerFont(n, f);
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      tickets.forEach((t, i) => {
        if (i % PER_PAGE === 0) {
          doc.addPage({ size: A4, margin: 0 });
          cutLines(doc);
          const first = tickets[i].serial, last = tickets[Math.min(i + PER_PAGE, tickets.length) - 1].serial;
          doc.font('mono').fontSize(6).fillColor('#9A9A9A')
            .text(`${batch.label} · #${String(first).padStart(4, '0')}–#${String(last).padStart(4, '0')} · page ${i / PER_PAGE + 1}/${Math.ceil(tickets.length / PER_PAGE)}`, MARGIN, A4[1] - 12, { lineBreak: false });
        }
        const k = i % PER_PAGE;
        ticket(doc, MARGIN + (k % COLS) * TW, MARGIN + Math.floor(k / COLS) * TH, t, event, batch);
      });
      doc.end();
    });
  };
}
