// Internal team sections: stock, promo calendar, events & bar stats, event ideas, user accounts.
import { now, transaction, str, num, isDate, oneOf } from './db.js';
import { ROLES, hashPassword } from './auth.js';

const CATEGORIES = ['alko', 'nealko', 'material'];
const DEALS = ['normal', 'komis', 'free'];  // komis = consignment (unsold goes back), free = from a partner
const UNITS = ['ks', 'fľ.', 'sud', 'bal.', 'karton', 'l', 'kg', 'm'];
const MOVE_REASONS = ['purchase', 'event', 'loss', 'correction'];
const CHANNELS = ['Instagram', 'TikTok', 'Facebook', 'Plagáty', 'Rádio', 'Influencer', 'Newsletter', 'Iné'];
const PROMO_STATUS = ['planned', 'ready', 'posted'];
const SERIES = ['Chodbovica', 'Chillout', 'Other'];
const IDEA_STATUS = ['new', 'discussing', 'approved', 'rejected'];
const STAFF_GROUPS = ['Prep', 'Bar', 'Radio'];
const HOURS = Array.from({ length: 19 }, (_, i) => 7 + i); // 07:00 ... 01:00 (25)

const bad = (res, msg) => res.status(400).json({ error: msg });

export function registerHub(app, { db, auth }) {
  const need = auth.requireSection;

  // ---------- Events (used by stats, stock and promo) ----------
  app.get('/api/events', need(), (req, res) => {
    res.json(db.prepare("SELECT * FROM events ORDER BY COALESCE(date, '9999') DESC").all());
  });

  function readEvent(b) {
    const e = {
      series: oneOf(b.series, SERIES, 'Other'), edition: str(b.edition, 20), name: str(b.name, 80),
      date: isDate(b.date) ? b.date : null, venue: str(b.venue, 120), attendance: num(b.attendance), notes: str(b.notes, 1000)
    };
    if (!e.name) e.name = [e.series, e.edition].filter(Boolean).join(' ');
    return e;
  }
  app.post('/api/events', need('stats'), (req, res) => {
    const e = readEvent(req.body);
    if (!e.name) return bad(res, 'Name the event.');
    const r = db.prepare('INSERT INTO events (series, edition, name, date, venue, attendance, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.series, e.edition, e.name, e.date, e.venue, e.attendance, e.notes);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/events/:id', need('stats'), (req, res) => {
    const e = readEvent(req.body);
    if (!e.name) return bad(res, 'Name the event.');
    db.prepare('UPDATE events SET series=?, edition=?, name=?, date=?, venue=?, attendance=?, notes=?, demo=0 WHERE id=?')
      .run(e.series, e.edition, e.name, e.date, e.venue, e.attendance, e.notes, Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/events/:id', need('stats'), (req, res) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Bars & bar sales ----------
  app.get('/api/events/:id/bars', need('stats'), (req, res) => {
    const bars = db.prepare('SELECT * FROM bars WHERE event_id = ? ORDER BY name').all(Number(req.params.id));
    const sales = db.prepare(`SELECT s.* FROM bar_sales s JOIN bars b ON b.id = s.bar_id WHERE b.event_id = ? ORDER BY s.revenue_cents DESC`)
      .all(Number(req.params.id));
    res.json(bars.map((b) => ({ ...b, sales: sales.filter((s) => s.bar_id === b.id) })));
  });
  app.post('/api/events/:id/bars', need('stats'), (req, res) => {
    const name = str(req.body.name, 60);
    if (!name) return bad(res, 'Name the bar.');
    const r = db.prepare('INSERT INTO bars (event_id, name) VALUES (?, ?)').run(Number(req.params.id), name);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.delete('/api/bars/:id', need('stats'), (req, res) => {
    db.prepare('DELETE FROM bars WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/bars/:id/sales', need('stats'), (req, res) => {
    const product = str(req.body.product, 60);
    const qty = num(req.body.qty);
    const revenue = num(req.body.revenue);
    if (!product || qty === null || qty < 0) return bad(res, 'Fill in the product and amount sold.');
    const r = db.prepare('INSERT INTO bar_sales (bar_id, product, category, qty, revenue_cents) VALUES (?, ?, ?, ?, ?)')
      .run(Number(req.params.id), product, oneOf(req.body.category, ['alko', 'nealko'], 'alko'), qty, Math.round((revenue || 0) * 100));
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.delete('/api/sales/:id', need('stats'), (req, res) => {
    db.prepare('DELETE FROM bar_sales WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Stats: compare events ----------
  app.get('/api/stats', need('stats'), (req, res) => {
    const events = db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM bars b WHERE b.event_id = e.id) AS bar_count,
        (SELECT COALESCE(SUM(s.revenue_cents), 0) FROM bar_sales s JOIN bars b ON b.id = s.bar_id WHERE b.event_id = e.id) AS bar_revenue,
        (SELECT COALESCE(SUM(CASE WHEN s.category='alko' THEN s.revenue_cents END), 0) FROM bar_sales s JOIN bars b ON b.id = s.bar_id WHERE b.event_id = e.id) AS alko_revenue,
        (SELECT COALESCE(SUM(CASE WHEN s.category='nealko' THEN s.revenue_cents END), 0) FROM bar_sales s JOIN bars b ON b.id = s.bar_id WHERE b.event_id = e.id) AS nealko_revenue
      FROM events e ORDER BY COALESCE(e.date, '9999')`).all();
    const topBar = db.prepare(`SELECT b.name, SUM(s.revenue_cents) AS revenue FROM bar_sales s JOIN bars b ON b.id = s.bar_id
                               WHERE b.event_id = ? GROUP BY b.id ORDER BY revenue DESC LIMIT 1`);
    const topProduct = db.prepare(`SELECT s.product, SUM(s.qty) AS qty, SUM(s.revenue_cents) AS revenue FROM bar_sales s JOIN bars b ON b.id = s.bar_id
                                   WHERE b.event_id = ? GROUP BY s.product ORDER BY revenue DESC LIMIT 1`);
    const perBarTop = db.prepare(`SELECT b.name AS bar, s.product, s.qty, s.revenue_cents FROM bar_sales s JOIN bars b ON b.id = s.bar_id
                                  WHERE b.event_id = ? AND s.revenue_cents = (SELECT MAX(s2.revenue_cents) FROM bar_sales s2 WHERE s2.bar_id = b.id)
                                  ORDER BY s.revenue_cents DESC`);
    const products = db.prepare(`SELECT s.product, s.category, SUM(s.qty) AS qty, SUM(s.revenue_cents) AS revenue
                                 FROM bar_sales s GROUP BY s.product ORDER BY revenue DESC LIMIT 12`).all();
    res.json({
      events: events.map((e) => ({
        ...e,
        top_bar: topBar.get(e.id) || null,
        top_product: topProduct.get(e.id) || null,
        per_bar_top: perBarTop.all(e.id),
        revenue_per_guest: e.attendance ? Math.round(e.bar_revenue / e.attendance) : null
      })),
      products
    });
  });

  // ---------- Stock (sklad) ----------
  app.get('/api/stock', need('stock'), (req, res) => {
    const items = db.prepare("SELECT * FROM stock_items ORDER BY CASE category WHEN 'alko' THEN 0 WHEN 'nealko' THEN 1 ELSE 2 END, name, volume_l").all();
    const moves = db.prepare(`SELECT m.*, i.name AS item, i.unit, i.volume_l, u.name AS user, e.name AS event FROM stock_moves m
                              JOIN stock_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id
                              LEFT JOIN events e ON e.id = m.event_id ORDER BY m.created_at DESC, m.id DESC LIMIT 150`).all();
    res.json({ items, moves, units: UNITS, reasons: MOVE_REASONS, categories: CATEGORIES, deals: DEALS });
  });
  function readItem(b) {
    const price = num(b.unit_price);
    return {
      name: str(b.name, 80), category: oneOf(b.category, CATEGORIES, 'alko'), unit: oneOf(b.unit, UNITS, 'ks'),
      volume_l: num(b.volume_l), unit_price_cents: price === null ? null : Math.round(price * 100),
      min_qty: Math.max(0, num(b.min_qty) || 0), note: str(b.note, 300)
    };
  }
  app.post('/api/stock/items', need('stock'), (req, res) => {
    const i = readItem(req.body);
    if (!i.name) return bad(res, 'Name the item.');
    const r = db.prepare('INSERT INTO stock_items (name, category, unit, volume_l, unit_price_cents, qty, min_qty, note) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .run(i.name, i.category, i.unit, i.volume_l, i.unit_price_cents, i.min_qty, i.note);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/stock/items/:id', need('stock'), (req, res) => {
    const i = readItem(req.body);
    if (!i.name) return bad(res, 'Name the item.');
    db.prepare('UPDATE stock_items SET name=?, category=?, unit=?, volume_l=?, unit_price_cents=?, min_qty=?, note=?, demo=0 WHERE id=?')
      .run(i.name, i.category, i.unit, i.volume_l, i.unit_price_cents, i.min_qty, i.note, Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/stock/items/:id', need('stock'), (req, res) => {
    db.prepare('DELETE FROM stock_items WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  // A stock movement: + for purchases, - for usage at an event / losses. "correction" sets the counted amount.
  app.post('/api/stock/moves', need('stock'), (req, res) => {
    const itemId = Number(req.body.item_id);
    const reason = oneOf(req.body.reason, MOVE_REASONS, null);
    const amount = num(req.body.amount);
    if (!reason || amount === null || amount < 0) return bad(res, 'Choose the item, reason and amount.');
    const price = num(req.body.unit_price);
    const when = isDate(req.body.date) ? new Date(req.body.date + 'T12:00').getTime() : now();
    try {
      const out = transaction(db, () => {
        const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(itemId);
        if (!item) throw Object.assign(new Error('Item not found'), { user: true });
        let delta;
        if (reason === 'correction') delta = amount - item.qty;                 // amount = what was counted
        else if (reason === 'purchase') delta = amount;
        else delta = -amount;                                                   // event usage, loss
        if (item.qty + delta < 0) throw Object.assign(new Error(`Only ${item.qty} ${item.unit} in stock.`), { user: true });
        db.prepare('UPDATE stock_items SET qty = qty + ? WHERE id = ?').run(delta, itemId);
        // A purchase with a price also updates the item's current unit price
        if (reason === 'purchase' && price !== null) db.prepare('UPDATE stock_items SET unit_price_cents = ? WHERE id = ?').run(Math.round(price * 100), itemId);
        db.prepare(`INSERT INTO stock_moves (item_id, delta, reason, event_id, note, user_id, created_at, unit_price_cents, source, deal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(itemId, delta, reason, num(req.body.event_id), str(req.body.note, 300), req.user.id, when,
            price === null ? null : Math.round(price * 100), str(req.body.source, 60), oneOf(req.body.deal, DEALS, 'normal'));
        return { qty: item.qty + delta };
      });
      res.json(out);
    } catch (e) {
      if (e.user) return bad(res, e.message);
      throw e;
    }
  });
  // Undo a movement: reverse its effect on the stock, then remove it
  app.delete('/api/stock/moves/:id', need('stock'), (req, res) => {
    try {
      transaction(db, () => {
        const m = db.prepare('SELECT m.*, i.qty FROM stock_moves m JOIN stock_items i ON i.id = m.item_id WHERE m.id = ?').get(Number(req.params.id));
        if (!m) throw Object.assign(new Error('Not found'), { user: true });
        if (m.qty - m.delta < 0) throw Object.assign(new Error('Cannot undo: stock would go below zero.'), { user: true });
        db.prepare('UPDATE stock_items SET qty = qty - ? WHERE id = ?').run(m.delta, m.item_id);
        db.prepare('DELETE FROM stock_moves WHERE id = ?').run(m.id);
      });
      res.json({ ok: true });
    } catch (e) {
      if (e.user) return bad(res, e.message);
      throw e;
    }
  });

  // ---------- Promo calendar ----------
  app.get('/api/promo', need('promo'), (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? req.query.month : new Date().toISOString().slice(0, 7);
    const items = db.prepare(`SELECT p.*, e.name AS event FROM promo p LEFT JOIN events e ON e.id = p.event_id
                              WHERE p.date LIKE ? ORDER BY p.date, COALESCE(p.time, '')`).all(month + '-%');
    const upcoming = db.prepare(`SELECT p.*, e.name AS event FROM promo p LEFT JOIN events e ON e.id = p.event_id
                                 WHERE p.date >= ? AND p.status != 'posted' ORDER BY p.date, COALESCE(p.time, '') LIMIT 8`)
      .all(new Date().toISOString().slice(0, 10));
    res.json({ month, items, upcoming, channels: CHANNELS, statuses: PROMO_STATUS });
  });
  function readPromo(b) {
    return {
      date: isDate(b.date) ? b.date : null, time: /^\d{2}:\d{2}$/.test(String(b.time)) ? b.time : null,
      channel: oneOf(b.channel, CHANNELS, 'Iné'), title: str(b.title, 120), event_id: num(b.event_id),
      owner: str(b.owner, 60), status: oneOf(b.status, PROMO_STATUS, 'planned'), note: str(b.note, 1000)
    };
  }
  app.post('/api/promo', need('promo'), (req, res) => {
    const p = readPromo(req.body);
    if (!p.date || !p.title) return bad(res, 'Fill in the date and what is being posted.');
    const r = db.prepare('INSERT INTO promo (date, time, channel, title, event_id, owner, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.date, p.time, p.channel, p.title, p.event_id, p.owner, p.status, p.note);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/promo/:id', need('promo'), (req, res) => {
    const p = readPromo(req.body);
    if (!p.date || !p.title) return bad(res, 'Fill in the date and what is being posted.');
    db.prepare('UPDATE promo SET date=?, time=?, channel=?, title=?, event_id=?, owner=?, status=?, note=?, demo=0 WHERE id=?')
      .run(p.date, p.time, p.channel, p.title, p.event_id, p.owner, p.status, p.note, Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/promo/:id', need('promo'), (req, res) => {
    db.prepare('DELETE FROM promo WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Ideas ----------
  app.get('/api/ideas', need('ideas'), (req, res) => {
    const ideas = db.prepare(`SELECT i.*, u.name AS author,
        COALESCE((SELECT SUM(value) FROM idea_votes v WHERE v.idea_id = i.id), 0) AS score,
        (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id AND v.value = 1) AS ups,
        (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id AND v.value = -1) AS downs,
        (SELECT value FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = ?) AS my_vote
      FROM ideas i LEFT JOIN users u ON u.id = i.author_id ORDER BY score DESC, i.created_at DESC`).all(req.user.id);
    const points = db.prepare(`SELECT p.*, u.name AS author FROM idea_points p LEFT JOIN users u ON u.id = p.author_id ORDER BY p.created_at`).all();
    res.json({
      statuses: IDEA_STATUS,
      ideas: ideas.map((i) => ({
        ...i,
        mine: i.author_id === req.user.id,
        plus: points.filter((p) => p.idea_id === i.id && p.kind === 'plus'),
        minus: points.filter((p) => p.idea_id === i.id && p.kind === 'minus')
      }))
    });
  });
  app.post('/api/ideas', need('ideas'), (req, res) => {
    const title = str(req.body.title, 120);
    if (!title) return bad(res, 'Give the idea a name.');
    const r = db.prepare('INSERT INTO ideas (title, description, why, author_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(title, str(req.body.description, 2000), str(req.body.why, 1000), req.user.id, now());
    res.json({ id: Number(r.lastInsertRowid) });
  });
  // Status can be changed by admin; the text by the author or admin
  app.put('/api/ideas/:id', need('ideas'), (req, res) => {
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: 'Not found' });
    const isAdmin = req.user.role === 'admin';
    if (req.body.status !== undefined) {
      if (!isAdmin) return res.status(403).json({ error: 'Only admin can change the status.' });
      db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(oneOf(req.body.status, IDEA_STATUS, idea.status), idea.id);
    }
    if (req.body.title !== undefined) {
      if (!isAdmin && idea.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can edit this idea.' });
      const title = str(req.body.title, 120);
      if (!title) return bad(res, 'Give the idea a name.');
      db.prepare('UPDATE ideas SET title=?, description=?, why=? WHERE id=?').run(title, str(req.body.description, 2000), str(req.body.why, 1000), idea.id);
    }
    res.json({ ok: true });
  });
  app.delete('/api/ideas/:id', need('ideas'), (req, res) => {
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && idea.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can delete this idea.' });
    db.prepare('DELETE FROM ideas WHERE id = ?').run(idea.id);
    res.json({ ok: true });
  });
  app.post('/api/ideas/:id/points', need('ideas'), (req, res) => {
    const text = str(req.body.text, 300);
    const kind = oneOf(req.body.kind, ['plus', 'minus'], null);
    if (!text || !kind) return bad(res, 'Write the point.');
    db.prepare('INSERT INTO idea_points (idea_id, kind, text, author_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(Number(req.params.id), kind, text, req.user.id, now());
    res.json({ ok: true });
  });
  app.delete('/api/points/:id', need('ideas'), (req, res) => {
    const p = db.prepare('SELECT * FROM idea_points WHERE id = ?').get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && p.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can delete this.' });
    db.prepare('DELETE FROM idea_points WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });
  // Vote +1 / -1; voting the same way again removes the vote
  app.post('/api/ideas/:id/vote', need('ideas'), (req, res) => {
    const value = Number(req.body.value) === -1 ? -1 : 1;
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT value FROM idea_votes WHERE idea_id = ? AND user_id = ?').get(id, req.user.id);
    if (cur && cur.value === value) db.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND user_id = ?').run(id, req.user.id);
    else db.prepare('INSERT INTO idea_votes (idea_id, user_id, value) VALUES (?, ?, ?) ON CONFLICT(idea_id, user_id) DO UPDATE SET value = excluded.value')
      .run(id, req.user.id, value);
    res.json({ ok: true });
  });

  // ---------- Staff planning ----------
  const cleanHours = (v) => {
    const list = Array.isArray(v) ? v : String(v || '').split(',');
    return [...new Set(list.map(Number).filter((h) => HOURS.includes(h)))].sort((a, b) => a - b).join(',');
  };
  app.get('/api/staff', need('staff'), (req, res) => {
    const days = db.prepare(`SELECT d.*, e.name AS event,
        (SELECT COUNT(*) FROM staff_rows r WHERE r.day_id = d.id) AS people
      FROM staff_days d LEFT JOIN events e ON e.id = d.event_id ORDER BY d.date DESC, d.id DESC`).all();
    const people = db.prepare('SELECT person, COUNT(*) AS n FROM staff_rows GROUP BY lower(person) ORDER BY n DESC, person').all();
    res.json({ days, people: people.map((p) => p.person), groups: STAFF_GROUPS, hours: HOURS });
  });
  app.get('/api/staff/days/:id', need('staff'), (req, res) => {
    const day = db.prepare('SELECT d.*, e.name AS event FROM staff_days d LEFT JOIN events e ON e.id = d.event_id WHERE d.id = ?').get(Number(req.params.id));
    if (!day) return res.status(404).json({ error: 'Not found' });
    const rows = db.prepare('SELECT * FROM staff_rows WHERE day_id = ? ORDER BY sort, id').all(day.id);
    res.json({ day, rows: rows.map((r) => ({ ...r, hours: r.hours ? r.hours.split(',').map(Number) : [] })), groups: STAFF_GROUPS, hours: HOURS });
  });
  app.post('/api/staff/days', need('staff'), (req, res) => {
    const date = isDate(req.body.date) ? req.body.date : null;
    const title = str(req.body.title, 100);
    if (!date || !title) return bad(res, 'Fill in the date and a title.');
    const copyFrom = num(req.body.copy_from);
    const id = transaction(db, () => {
      const r = db.prepare('INSERT INTO staff_days (date, title, event_id, notes, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(date, title, num(req.body.event_id), str(req.body.notes, 1000), now());
      const dayId = Number(r.lastInsertRowid);
      if (copyFrom) {
        db.prepare('INSERT INTO staff_rows (day_id, grp, person, hours, note, sort) SELECT ?, grp, person, hours, note, sort FROM staff_rows WHERE day_id = ?')
          .run(dayId, copyFrom);
      }
      return dayId;
    });
    res.json({ id });
  });
  app.put('/api/staff/days/:id', need('staff'), (req, res) => {
    const date = isDate(req.body.date) ? req.body.date : null;
    const title = str(req.body.title, 100);
    if (!date || !title) return bad(res, 'Fill in the date and a title.');
    db.prepare('UPDATE staff_days SET date=?, title=?, event_id=?, notes=? WHERE id=?')
      .run(date, title, num(req.body.event_id), str(req.body.notes, 1000), Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/staff/days/:id', need('staff'), (req, res) => {
    db.prepare('DELETE FROM staff_days WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/staff/days/:id/rows', need('staff'), (req, res) => {
    const person = str(req.body.person, 60);
    if (!person) return bad(res, 'Write a name.');
    const dayId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM staff_days WHERE id = ?').get(dayId)) return res.status(404).json({ error: 'Not found' });
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM staff_rows WHERE day_id = ?').get(dayId).s;
    const r = db.prepare('INSERT INTO staff_rows (day_id, grp, person, hours, note, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(dayId, str(req.body.grp, 30) || 'Prep', person, cleanHours(req.body.hours), str(req.body.note, 200), sort);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/staff/rows/:id', need('staff'), (req, res) => {
    const row = db.prepare('SELECT * FROM staff_rows WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const person = req.body.person !== undefined ? str(req.body.person, 60) : row.person;
    if (!person) return bad(res, 'Write a name.');
    db.prepare('UPDATE staff_rows SET grp=?, person=?, hours=?, note=? WHERE id=?').run(
      req.body.grp !== undefined ? (str(req.body.grp, 30) || row.grp) : row.grp,
      person,
      req.body.hours !== undefined ? cleanHours(req.body.hours) : row.hours,
      req.body.note !== undefined ? str(req.body.note, 200) : row.note,
      row.id);
    res.json({ ok: true });
  });
  app.delete('/api/staff/rows/:id', need('staff'), (req, res) => {
    db.prepare('DELETE FROM staff_rows WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Users (admin) ----------
  app.get('/api/users', need('users'), (req, res) => {
    res.json({ roles: ROLES, users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY role, name').all() });
  });
  app.post('/api/users', need('users'), (req, res) => {
    const email = str(req.body.email, 120)?.toLowerCase();
    const name = str(req.body.name, 60);
    const password = String(req.body.password || '');
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || !name) return bad(res, 'Fill in name and email.');
    if (password.length < 5) return bad(res, 'Password needs at least 5 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'This email already has an account.');
    db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, oneOf(req.body.role, Object.keys(ROLES), 'team'), hashPassword(password), now());
    res.json({ ok: true });
  });
  app.put('/api/users/:id', need('users'), (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (req.body.role !== undefined) {
      const role = oneOf(req.body.role, Object.keys(ROLES), user.role);
      if (user.id === req.user.id && role !== 'admin') return bad(res, 'You cannot remove your own admin role.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    }
    if (req.body.password !== undefined) {
      if (String(req.body.password).length < 5) return bad(res, 'Password needs at least 5 characters.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').run(id, req.user.id); // log them out elsewhere
    }
    res.json({ ok: true });
  });
  app.delete('/api/users/:id', need('users'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return bad(res, 'You cannot delete yourself.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });
}
