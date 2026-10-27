// Public sign-up for staff days: the team opens a link per day, people add their name and hours themselves.
import path from 'node:path';
import { now, randomId, str, transaction } from './db.js';

const HOURS = Array.from({ length: 19 }, (_, i) => 7 + i); // 07:00 … 01:00 (25)
const cleanHours = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((h) => HOURS.includes(h)))].sort((a, b) => a - b).join(',');
const parseGroups = (v) => { try { const g = JSON.parse(v || '[]'); return Array.isArray(g) ? g : []; } catch { return []; } };
const MAX_ROWS_PER_DAY = 300;

export function registerSignup(app, { db, auth, publicDir }) {
  const need = auth.requireSection('staff');

  // ---- Team side: open / close the public link and choose the sections ----
  app.get('/api/staff/days/:id/public', need, (req, res) => {
    const d = db.prepare('SELECT id, public_token, public_open, public_groups FROM staff_days WHERE id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json({ open: Boolean(d.public_open), token: d.public_token, groups: parseGroups(d.public_groups) });
  });

  app.put('/api/staff/days/:id/public', need, (req, res) => {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM staff_days WHERE id = ?').get(id);
    if (!d) return res.status(404).json({ error: 'Not found' });
    const groups = [...new Set((Array.isArray(req.body.groups) ? req.body.groups : String(req.body.groups || '').split(','))
      .map((g) => str(g, 30)).filter(Boolean))].slice(0, 12);
    const open = Boolean(req.body.open);
    if (open && !groups.length) return res.status(400).json({ error: 'Add at least one section people can sign up for.' });
    const token = d.public_token || randomId(12);
    db.prepare('UPDATE staff_days SET public_open = ?, public_groups = ?, public_token = ? WHERE id = ?').run(open ? 1 : 0, JSON.stringify(groups), token, id);
    res.json({ open, token, groups });
  });

  // New link: the old one stops working
  app.post('/api/staff/days/:id/public/new-link', need, (req, res) => {
    const token = randomId(12);
    db.prepare('UPDATE staff_days SET public_token = ? WHERE id = ?').run(token, Number(req.params.id));
    res.json({ token });
  });

  // ---- Public side (no login) ----
  app.get('/join/:token', (req, res) => res.sendFile(path.join(publicDir, 'join.html')));

  function openDay(token) {
    const d = db.prepare(`SELECT d.*, e.name AS event FROM staff_days d LEFT JOIN events e ON e.id = d.event_id
                          WHERE d.public_token = ?`).get(String(token || ''));
    return d && d.public_open ? d : null;
  }

  app.get('/api/join/:token', (req, res) => {
    const d = openDay(req.params.token);
    if (!d) return res.status(404).json({ error: 'This sign-up link is closed or does not exist.' });
    const groups = parseGroups(d.public_groups);
    const rows = db.prepare('SELECT grp, person, hours FROM staff_rows WHERE day_id = ? ORDER BY grp, sort, id').all(d.id)
      .filter((r) => groups.includes(r.grp))
      .map((r) => ({ grp: r.grp, person: r.person, hours: r.hours ? r.hours.split(',').map(Number) : [] }));
    res.json({ day: { title: d.title, date: d.date, event: d.event, notes: d.notes }, groups, hours: HOURS, rows });
  });

  // Simple flood protection: max 15 sign-ups per IP per hour
  const recent = new Map();
  const tooMany = (ip) => {
    const list = (recent.get(ip) || []).filter((t) => now() - t < 3600000);
    recent.set(ip, list);
    return list.length >= 15;
  };

  app.post('/api/join/:token', (req, res) => {
    const d = openDay(req.params.token);
    if (!d) return res.status(404).json({ error: 'This sign-up link is closed.' });
    if (req.body.website) return res.json({ ok: true }); // hidden field: bots fill it in, people do not
    if (tooMany(req.ip)) return res.status(429).json({ error: 'Too many sign-ups from this device. Try again later.' });
    const groups = parseGroups(d.public_groups);
    const grp = groups.includes(req.body.grp) ? req.body.grp : null;
    const person = str(req.body.person, 40);
    const hours = cleanHours(req.body.hours);
    if (!grp) return res.status(400).json({ error: 'Choose a section.' });
    if (!person || person.length < 2) return res.status(400).json({ error: 'Write your name.' });
    if (!hours) return res.status(400).json({ error: 'Mark at least one hour when you can come.' });
    const editToken = randomId(12);
    try {
      transaction(db, () => {
        const count = db.prepare('SELECT COUNT(*) AS n FROM staff_rows WHERE day_id = ?').get(d.id).n;
        if (count >= MAX_ROWS_PER_DAY) throw Object.assign(new Error('This day is full.'), { user: true });
        const dup = db.prepare('SELECT 1 FROM staff_rows WHERE day_id = ? AND grp = ? AND lower(person) = lower(?)').get(d.id, grp, person);
        if (dup) throw Object.assign(new Error(`${person} is already signed up in ${grp}. Use your edit link to change the times, or add a surname.`), { user: true });
        const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM staff_rows WHERE day_id = ?').get(d.id).s;
        db.prepare('INSERT INTO staff_rows (day_id, grp, person, hours, note, sort, self, edit_token) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
          .run(d.id, grp, person, hours, str(req.body.note, 150), sort, editToken);
      });
    } catch (e) {
      if (e.user) return res.status(400).json({ error: e.message });
      throw e;
    }
    recent.get(req.ip).push(now());
    res.json({ ok: true, editToken });
  });

  // The person changes or removes their own entry with their edit token
  const own = (req) => {
    const d = openDay(req.params.token);
    if (!d) return null;
    return db.prepare('SELECT * FROM staff_rows WHERE day_id = ? AND edit_token = ?').get(d.id, String(req.params.edit || ''));
  };
  app.get('/api/join/:token/me/:edit', (req, res) => {
    const r = own(req);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ grp: r.grp, person: r.person, hours: r.hours ? r.hours.split(',').map(Number) : [], note: r.note || '' });
  });
  app.put('/api/join/:token/me/:edit', (req, res) => {
    const r = own(req);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const hours = cleanHours(req.body.hours);
    if (!hours) return res.status(400).json({ error: 'Mark at least one hour, or remove your sign-up.' });
    db.prepare('UPDATE staff_rows SET hours = ?, note = ? WHERE id = ?').run(hours, str(req.body.note, 150), r.id);
    res.json({ ok: true });
  });
  app.delete('/api/join/:token/me/:edit', (req, res) => {
    const r = own(req);
    if (!r) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM staff_rows WHERE id = ?').run(r.id);
    res.json({ ok: true });
  });
}
