// PDF tickets for buyers + the ticket design settings (Admin → Ticket design).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { getSetting, setSetting, str, num, oneOf } from './db.js';
import { createTicketPdf, DEFAULT_DESIGN } from './ticketpdf.js';

const MAX_IMAGE = 8 * 1024 * 1024;

export function registerDesign(app, { db, auth, event, assetsDir, dataDir }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const render = createTicketPdf({ assetsDir, uploadsDir });
  const design = () => ({ ...DEFAULT_DESIGN, ...getSetting(db, 'ticket_design', {}) });
  const fileName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function sendPdf(res, buf, name, download) {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'no-store'
    });
    res.send(buf);
  }

  // Buyer: all tickets of an order in one PDF (or one ticket with ?n=1)
  app.get('/order/:id/tickets.pdf', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND access_token = ?').get(req.params.id, String(req.query.t || ''));
    if (!order || order.status !== 'paid') return res.status(404).send('Not found');
    let tickets = db.prepare('SELECT * FROM tickets WHERE order_id = ? ORDER BY id').all(order.id).map((t, index) => ({ ...t, index }));
    const n = Number(req.query.n);
    const all = tickets.length;
    if (n >= 1 && n <= tickets.length) tickets = [tickets[n - 1]];
    const buf = await render({ design: design(), event, order, tickets, total: all });
    const base = `${fileName(event.name)}-ticket${tickets.length > 1 ? 's' : ''}${n ? '-' + n : ''}.pdf`;
    sendPdf(res, buf, base, req.query.download !== '0');
  });

  // ---- Ticket design (ticket staff + admin) ----
  const need = auth.requireSection('tickets');
  const artFile = () => ['jpg', 'png'].map((e) => path.join(uploadsDir, `ticket-art.${e}`)).find((p) => fs.existsSync(p)) || null;

  app.get('/api/ticket-design', need, (req, res) => {
    res.json({ design: design(), defaults: DEFAULT_DESIGN, hasArtwork: Boolean(artFile()), event });
  });

  app.put('/api/ticket-design', need, (req, res) => {
    const b = req.body;
    const d = {
      theme: oneOf(b.theme, ['dark', 'light'], 'dark'),
      layout: oneOf(b.layout, ['banner', 'background', 'none'], 'banner'),
      overlay: Math.min(95, Math.max(0, Math.round(num(b.overlay) ?? 60))),
      headline: str(b.headline, 60) || '',
      tagline: str(b.tagline, 80) || '',
      info: str(b.info, 120) || '',
      terms: str(b.terms, 600) || '',
      showPrice: b.showPrice === true || b.showPrice === 'on' || b.showPrice === 'true'
    };
    setSetting(db, 'ticket_design', d);
    res.json({ ok: true, design: d });
  });

  app.post('/api/ticket-design/artwork', need, express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_IMAGE }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Upload a PNG or JPG image (max 8 MB).' });
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isPng && !isJpg) return res.status(400).json({ error: 'Only PNG or JPG images work.' });
    for (const e of ['jpg', 'png']) fs.rmSync(path.join(uploadsDir, `ticket-art.${e}`), { force: true });
    fs.writeFileSync(path.join(uploadsDir, `ticket-art.${isPng ? 'png' : 'jpg'}`), buf);
    res.json({ ok: true });
  });

  app.delete('/api/ticket-design/artwork', need, (req, res) => {
    for (const e of ['jpg', 'png']) fs.rmSync(path.join(uploadsDir, `ticket-art.${e}`), { force: true });
    res.json({ ok: true });
  });

  app.get('/api/ticket-design/artwork', need, (req, res) => {
    const f = artFile();
    if (!f) return res.status(404).end();
    res.set('Cache-Control', 'no-store').sendFile(f);
  });

  // Preview with sample tickets and the saved design
  app.get('/api/ticket-design/preview.pdf', need, async (req, res) => {
    const order = { id: 'PREVIEW' };
    const tickets = [
      { code: 'BASE-PREV-IEW1', holder: 'Jana Nováková' },
      { code: 'BASE-PREV-IEW2', holder: 'Peter Horváth' }
    ];
    const buf = await render({ design: design(), event, order, tickets, total: 2 });
    sendPdf(res, buf, 'ticket-preview.pdf', false);
  });
}
