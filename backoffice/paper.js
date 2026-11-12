// Printed (paper) tickets: generate in advance, assign to sellers, mark sold when sold.
// Only SOLD printed tickets count towards sales, revenue and capacity. Unsold ones do not open the door.
import crypto from 'node:crypto';
import { now, transaction, str, num, oneOf } from './db.js';
import { createPaperPdf } from './paperpdf.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UNDO_MINUTES = 15;
const KINDS = ['presale', 'door'];
const PAYMENTS = ['cash', 'card', 'free'];

export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
export const serialLabel = (n) => '#' + String(n).padStart(4, '0');

export function registerPaper(app, { db, auth, event, assetsDir, seatsTaken }) {
  const pdf = createPaperPdf({ assetsDir });
  const isStaff = (u) => u.role === 'admin' || u.role === 'tickets';

  function newCode() {
    for (;;) {
      let s = '';
      for (const b of crypto.randomBytes(12)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
      const code = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
      const taken = db.prepare('SELECT 1 FROM paper_tickets WHERE code = ? UNION SELECT 1 FROM tickets WHERE code = ?').get(code, code);
      if (!taken) return code;
    }
  }

  // Find a printed ticket from what was scanned or typed: a QR code, or just the number (#42 / 42)
  function findTicket(input) {
    const raw = String(input || '').trim();
    const digits = raw.replace(/^#/, '');
    if (/^\d{1,6}$/.test(digits)) return db.prepare('SELECT * FROM paper_tickets WHERE serial = ?').get(Number(digits));
    return db.prepare('SELECT * FROM paper_tickets WHERE code = ?').get(normCode(raw));
  }

  const userName = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name : null) || '—';
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });

  // ---------- Team: batches, assigning, voiding, printing ----------
  const staff = auth.requireSection('tickets');

  app.get('/api/paper', staff, (req, res) => {
    const batches = db.prepare(`SELECT b.*,
        SUM(p.status = 'sold') AS sold, SUM(p.status = 'unsold') AS unsold, SUM(p.status = 'void') AS void,
        SUM(p.assigned_to IS NOT NULL AND p.status = 'unsold') AS assigned_unsold,
        COALESCE(SUM(CASE WHEN p.status = 'sold' AND p.payment != 'free' THEN b.price_cents END), 0) AS revenue,
        SUM(p.checked_in_at IS NOT NULL) AS checked_in
      FROM ticket_batches b LEFT JOIN paper_tickets p ON p.batch_id = b.id GROUP BY b.id ORDER BY b.id DESC`).all();
    // Per person: what they hold, what they sold, how much money they should have
    const people = db.prepare(`SELECT u.id, u.name, u.role,
        (SELECT COUNT(*) FROM paper_tickets p WHERE p.assigned_to = u.id AND p.status = 'unsold') AS holding,
        (SELECT COUNT(*) FROM paper_tickets p WHERE p.seller_id = u.id AND p.status = 'sold') AS sold,
        (SELECT COALESCE(SUM(b.price_cents), 0) FROM paper_tickets p JOIN ticket_batches b ON b.id = p.batch_id WHERE p.seller_id = u.id AND p.status = 'sold' AND p.payment = 'cash') AS cash,
        (SELECT COALESCE(SUM(b.price_cents), 0) FROM paper_tickets p JOIN ticket_batches b ON b.id = p.batch_id WHERE p.seller_id = u.id AND p.status = 'sold' AND p.payment = 'card') AS card,
        (SELECT MIN(serial) || '–' || MAX(serial) FROM paper_tickets p WHERE p.assigned_to = u.id) AS range
      FROM users u WHERE u.role IN ('seller', 'tickets', 'admin') ORDER BY u.role = 'seller' DESC, u.name`).all();
    const recent = db.prepare(`SELECT p.serial, p.payment, p.sold_at, p.checked_in_at, b.kind, b.price_cents, u.name AS seller
      FROM paper_tickets p JOIN ticket_batches b ON b.id = p.batch_id LEFT JOIN users u ON u.id = p.seller_id
      WHERE p.status = 'sold' ORDER BY p.sold_at DESC LIMIT 50`).all();
    res.json({ event, batches, people, recent, kinds: KINDS });
  });

  app.post('/api/paper/batches', staff, (req, res) => {
    const qty = Math.round(num(req.body.qty) || 0);
    const price = num(req.body.price);
    const kind = oneOf(req.body.kind, KINDS, 'presale');
    if (qty < 1 || qty > 2000) return res.status(400).json({ error: 'Generate 1 to 2000 tickets at once.' });
    if (price === null || price < 0) return res.status(400).json({ error: 'Fill in the ticket price.' });
    const label = str(req.body.label, 60) || (kind === 'door' ? 'Door' : 'Presale');
    const out = transaction(db, () => {
      const first = (db.prepare('SELECT COALESCE(MAX(serial), 0) AS m FROM paper_tickets').get().m || 0) + 1;
      const r = db.prepare('INSERT INTO ticket_batches (label, kind, price_cents, first_serial, qty, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(label, kind, Math.round(price * 100), first, qty, str(req.body.note, 200), req.user.id, now());
      const batchId = Number(r.lastInsertRowid);
      const ins = db.prepare('INSERT INTO paper_tickets (batch_id, serial, code) VALUES (?, ?, ?)');
      for (let i = 0; i < qty; i++) ins.run(batchId, first + i, newCode());
      return { id: batchId, first, last: first + qty - 1 };
    });
    res.json(out);
  });

  app.delete('/api/paper/batches/:id', staff, (req, res) => {
    const id = Number(req.params.id);
    const sold = db.prepare("SELECT COUNT(*) AS n FROM paper_tickets WHERE batch_id = ? AND status = 'sold'").get(id).n;
    if (sold) return res.status(400).json({ error: 'Some tickets of this batch are sold. Void the unsold ones instead.' });
    db.prepare('DELETE FROM ticket_batches WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  function range(b) {
    const from = Math.round(num(String(b.from || '').replace('#', '')) || 0);
    const to = Math.round(num(String(b.to || '').replace('#', '')) || from);
    if (from < 1 || to < from || to - from > 5000) throw Object.assign(new Error('Give a valid number range, e.g. 1 to 50.'), { user: true });
    return [from, to];
  }
  const handle = (fn) => (req, res) => {
    try { res.json(fn(req)); } catch (e) { if (e.user) return res.status(400).json({ error: e.message }); throw e; }
  };

  // Give printed tickets #from–#to to a person (only unsold ones move). user_id empty = take them back.
  app.post('/api/paper/assign', staff, handle((req) => {
    const [from, to] = range(req.body);
    const userId = num(req.body.user_id);
    if (userId && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw Object.assign(new Error('Unknown person.'), { user: true });
    const r = db.prepare("UPDATE paper_tickets SET assigned_to = ? WHERE serial BETWEEN ? AND ? AND status = 'unsold'").run(userId || null, from, to);
    return { changed: Number(r.changes) };
  }));

  // Void unsold tickets (lost, damaged, or after the event). They will not open the door.
  app.post('/api/paper/void', staff, handle((req) => {
    const [from, to] = range(req.body);
    const r = db.prepare("UPDATE paper_tickets SET status = 'void' WHERE serial BETWEEN ? AND ? AND status = 'unsold'").run(from, to);
    return { changed: Number(r.changes) };
  }));
  app.post('/api/paper/unvoid', staff, handle((req) => {
    const [from, to] = range(req.body);
    const r = db.prepare("UPDATE paper_tickets SET status = 'unsold' WHERE serial BETWEEN ? AND ? AND status = 'void'").run(from, to);
    return { changed: Number(r.changes) };
  }));

  // Printable A4 sheets
  app.get('/api/paper/batches/:id/print.pdf', staff, async (req, res) => {
    const batch = db.prepare('SELECT * FROM ticket_batches WHERE id = ?').get(Number(req.params.id));
    if (!batch) return res.status(404).send('Not found');
    let from = Number(req.query.from) || batch.first_serial;
    let to = Number(req.query.to) || batch.first_serial + batch.qty - 1;
    const tickets = db.prepare('SELECT serial, code FROM paper_tickets WHERE batch_id = ? AND serial BETWEEN ? AND ? ORDER BY serial').all(batch.id, from, to);
    if (!tickets.length) return res.status(404).send('No tickets in that range');
    const buf = await pdf({ event, batch, tickets });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="printed-tickets-${String(tickets[0].serial).padStart(4, '0')}-${String(tickets.at(-1).serial).padStart(4, '0')}.pdf"`,
      'Cache-Control': 'no-store'
    });
    res.send(buf);
  });

  // ---------- Sellers ----------
  const seller = auth.requireSection('sell');

  app.get('/api/sell/me', seller, (req, res) => {
    const me = req.user.id;
    const holding = db.prepare("SELECT COUNT(*) AS n, MIN(serial) AS lo, MAX(serial) AS hi FROM paper_tickets WHERE assigned_to = ? AND status = 'unsold'").get(me);
    const sales = db.prepare(`SELECT p.serial, p.payment, p.sold_at, p.checked_in_at, b.kind, b.price_cents, b.label
      FROM paper_tickets p JOIN ticket_batches b ON b.id = p.batch_id
      WHERE p.seller_id = ? AND p.status = 'sold' ORDER BY p.sold_at DESC`).all(me);
    const sum = (pay) => sales.filter((s) => !pay || s.payment === pay).reduce((t, s) => t + (s.payment === 'free' ? 0 : s.price_cents), 0);
    res.json({
      event, name: req.user.name, staff: isStaff(req.user),
      holding: { count: Number(holding.n), from: holding.lo, to: holding.hi },
      sold: sales.length, cash: sum('cash'), card: sum('card'), revenue: sum(),
      remaining: Math.max(0, event.capacity - seatsTaken()),
      sales: sales.slice(0, 100).map((s) => ({ ...s, undo: !s.checked_in_at && now() - s.sold_at < UNDO_MINUTES * 60000 }))
    });
  });

  // Look a ticket up before selling (shows number, type, price, state)
  app.post('/api/sell/lookup', seller, (req, res) => {
    const t = findTicket(req.body.code);
    if (!t) return res.json({ found: false, message: 'Not a Base Presents printed ticket' });
    const b = db.prepare('SELECT * FROM ticket_batches WHERE id = ?').get(t.batch_id);
    res.json({
      found: true, serial: t.serial, label: serialLabel(t.serial), status: t.status, kind: b.kind, batch: b.label, price_cents: b.price_cents,
      mine: t.assigned_to === req.user.id, holder: userName(t.assigned_to),
      soldBy: t.seller_id ? userName(t.seller_id) : null, soldAt: t.sold_at ? fmtTime(t.sold_at) : null
    });
  });

  app.post('/api/sell', seller, handle((req) => {
    const payment = oneOf(req.body.payment, PAYMENTS, 'cash');
    if (payment === 'free' && !isStaff(req.user)) throw Object.assign(new Error('Only the ticket team can give free tickets.'), { user: true });
    return transaction(db, () => {
      const t = findTicket(req.body.code);
      if (!t) throw Object.assign(new Error('This is not a Base Presents printed ticket.'), { user: true });
      const label = serialLabel(t.serial);
      if (t.status === 'void') throw Object.assign(new Error(`${label} is voided and cannot be sold.`), { user: true });
      if (t.status === 'sold') throw Object.assign(new Error(`${label} is already sold (${userName(t.seller_id)}, ${fmtTime(t.sold_at)}).`), { user: true });
      if (!isStaff(req.user) && t.assigned_to !== req.user.id) {
        const who = t.assigned_to ? `it belongs to ${userName(t.assigned_to)}` : 'it was not given to anyone yet';
        throw Object.assign(new Error(`${label} is not one of your tickets (${who}).`), { user: true });
      }
      if (event.capacity - seatsTaken() < 1) throw Object.assign(new Error('The event is sold out (capacity reached).'), { user: true });
      const checkin = Boolean(req.body.checkin);
      db.prepare("UPDATE paper_tickets SET status = 'sold', seller_id = ?, sold_at = ?, payment = ?, checked_in_at = ? WHERE id = ?")
        .run(req.user.id, now(), payment, checkin ? now() : null, t.id);
      const b = db.prepare('SELECT * FROM ticket_batches WHERE id = ?').get(t.batch_id);
      return { ok: true, label, kind: b.kind, price_cents: payment === 'free' ? 0 : b.price_cents, payment, checkedIn: checkin };
    });
  }));

  // Undo a sale: sellers within 15 minutes, ticket team any time (not after entry)
  app.post('/api/sell/undo', seller, handle((req) => {
    const t = findTicket(req.body.code);
    if (!t || t.status !== 'sold') throw Object.assign(new Error('That ticket is not sold.'), { user: true });
    if (t.checked_in_at) throw Object.assign(new Error('This ticket was already used at the door.'), { user: true });
    if (!isStaff(req.user)) {
      if (t.seller_id !== req.user.id) throw Object.assign(new Error('You can only undo your own sales.'), { user: true });
      if (now() - t.sold_at > UNDO_MINUTES * 60000) throw Object.assign(new Error(`Undo works only for ${UNDO_MINUTES} minutes. Ask the ticket team.`), { user: true });
    }
    db.prepare("UPDATE paper_tickets SET status = 'unsold', seller_id = NULL, sold_at = NULL, payment = NULL WHERE id = ?").run(t.id);
    return { ok: true, label: serialLabel(t.serial) };
  }));

  // ---------- Used by the door scanner and the totals ----------
  return {
    soldCount: () => Number(db.prepare("SELECT COUNT(*) AS n FROM paper_tickets WHERE status = 'sold'").get().n),
    totals() {
      const rows = db.prepare(`SELECT b.kind, COUNT(*) AS sold,
          COALESCE(SUM(CASE WHEN p.payment != 'free' THEN b.price_cents END), 0) AS revenue,
          SUM(p.checked_in_at IS NOT NULL) AS checked_in
        FROM paper_tickets p JOIN ticket_batches b ON b.id = p.batch_id WHERE p.status = 'sold' GROUP BY b.kind`).all();
      const printed = Number(db.prepare("SELECT COUNT(*) AS n FROM paper_tickets WHERE status != 'void'").get().n);
      const get = (k) => rows.find((r) => r.kind === k) || { sold: 0, revenue: 0, checked_in: 0 };
      return { presale: get('presale'), door: get('door'), printed };
    },
    // Door check-in for a printed ticket; returns null when the code is not a printed ticket
    checkin(input) {
      const t = findTicket(input);
      if (!t) return null;
      const label = serialLabel(t.serial);
      if (t.status === 'void') return { result: 'invalid', message: `Printed ticket ${label} is voided`, code: label };
      if (t.status === 'unsold') return { result: 'unsold', message: `Printed ticket ${label} was never sold. Do not let in. Sell it first.`, code: label };
      if (t.checked_in_at) return { result: 'used', message: `${label} already used at ${fmtTime(t.checked_in_at)}`, holder: 'Printed ticket', code: label };
      db.prepare('UPDATE paper_tickets SET checked_in_at = ? WHERE id = ?').run(now(), t.id);
      return { result: 'ok', message: 'Welcome!', holder: `Printed ticket ${label} · sold by ${userName(t.seller_id)}`, code: label };
    }
  };
}
