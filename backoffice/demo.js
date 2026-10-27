// Starter data.
// - Real events from the BASE project report (dates, venues) are added once and stay.
// - DEMO numbers (attendance, bars, bar sales, stock, promo, ideas) are marked demo=1 and can be removed from the admin.
import { now } from './db.js';

const REAL_EVENTS = [
  { series: 'Chodbovica', edition: '1', date: '2022-11-15', venue: 'Jedlíkova 7, Košice' },
  { series: 'Chodbovica', edition: '2', date: '2023-11-14', venue: 'Jedlíkova 7, Košice' },
  { series: 'Chodbovica', edition: '3', date: '2024-11-12', venue: 'T-klub, Urbánkova 2, Košice' },
  { series: 'Chodbovica', edition: '4', date: '2025-11-11', venue: 'Jedlíkova 7, Košice' },
  { series: 'Chodbovica', edition: '5', date: '2026-11-16', venue: 'Jedlíkova 7, Košice' },
  { series: 'Chillout', edition: null, name: 'Chillout · máj 2025', date: '2025-05-05', venue: 'Jedlíkova 9, Košice' },
  { series: 'Chillout', edition: null, name: 'Chillout · sep 2025', date: '2025-09-23', venue: 'Jedlíkova 9, Košice' },
  { series: 'Chillout', edition: '10', date: null, venue: 'Jedlíkova 9, Košice', notes: 'Máj 2027 (možno ako „Chillout X“)' }
];

export function seedRealEvents(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  if (Number(count) > 0) return false;
  const ins = db.prepare('INSERT INTO events (series, edition, name, date, venue, notes) VALUES (?, ?, ?, ?, ?, ?)');
  for (const e of REAL_EVENTS) {
    ins.run(e.series, e.edition, e.name || `${e.series} ${e.edition}`, e.date, e.venue, e.notes || null);
  }
  return true; // fresh database
}

export function hasDemo(db) {
  const tables = ['bars', 'stock_items', 'promo', 'ideas'];
  return tables.some((t) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE demo = 1`).get().n) > 0)
    || Number(db.prepare('SELECT COUNT(*) AS n FROM events WHERE demo = 1').get().n) > 0;
}

export function removeDemo(db) {
  db.exec(`
    DELETE FROM bars WHERE demo = 1;
    DELETE FROM stock_items WHERE demo = 1;
    DELETE FROM promo WHERE demo = 1;
    DELETE FROM ideas WHERE demo = 1;
    UPDATE events SET attendance = NULL, demo = 0 WHERE demo = 1;
  `);
}

export function loadDemo(db, adminId) {
  const ev = (name) => db.prepare('SELECT id FROM events WHERE name = ?').get(name)?.id;

  // Attendance + bar sales for past events (sample numbers!)
  const sample = {
    'Chodbovica 2': { attendance: 950, bars: { 'Main bar': [['Pivo Šariš 0,5 l', 'alko', 820, 2.5], ['Jägermeister shot', 'alko', 310, 3], ['Red Bull', 'nealko', 260, 3]], 'Folk bar': [['Pivo Šariš 0,5 l', 'alko', 410, 2.5], ['Borovička shot', 'alko', 150, 2], ['Voda', 'nealko', 120, 1]] } },
    'Chodbovica 3': { attendance: 1150, bars: { 'Main bar': [['Pivo Šariš 0,5 l', 'alko', 980, 2.5], ['Jägermeister shot', 'alko', 420, 3], ['Red Bull', 'nealko', 300, 3]], 'Shot bar': [['Jägermeister shot', 'alko', 510, 3], ['Stock vodka shot', 'alko', 260, 2.5]], 'Chill bar': [['Kofola', 'nealko', 220, 1.5], ['Voda', 'nealko', 180, 1]] } },
    'Chodbovica 4': { attendance: 1400, bars: { 'Main bar': [['Pivo Šariš 0,5 l', 'alko', 1240, 2.5], ['Jägermeister shot', 'alko', 520, 3], ['Red Bull', 'nealko', 410, 3]], 'Shot bar': [['Jägermeister shot', 'alko', 640, 3], ['Stock vodka shot', 'alko', 330, 2.5], ['Borovička shot', 'alko', 210, 2]], 'International bar': [['Pivo Šariš 0,5 l', 'alko', 380, 2.5], ['Aperol spritz', 'alko', 140, 5]], 'Chill bar': [['Kofola', 'nealko', 260, 1.5], ['Voda', 'nealko', 240, 1]] } },
    'Chillout · máj 2025': { attendance: 480, bars: { 'Open-air bar': [['Pivo Šariš 0,5 l', 'alko', 620, 2.5], ['Aperol spritz', 'alko', 160, 5], ['Kofola', 'nealko', 210, 1.5]], 'Drink bar': [['Jägermeister shot', 'alko', 180, 3], ['Red Bull', 'nealko', 150, 3]] } },
    'Chillout · sep 2025': { attendance: 560, bars: { 'Open-air bar': [['Pivo Šariš 0,5 l', 'alko', 710, 2.5], ['Aperol spritz', 'alko', 190, 5], ['Kofola', 'nealko', 240, 1.5]], 'Drink bar': [['Jägermeister shot', 'alko', 230, 3], ['Red Bull', 'nealko', 170, 3], ['Voda', 'nealko', 130, 1]] } }
  };
  const insBar = db.prepare('INSERT INTO bars (event_id, name, demo) VALUES (?, ?, 1)');
  const insSale = db.prepare('INSERT INTO bar_sales (bar_id, product, category, qty, revenue_cents, demo) VALUES (?, ?, ?, ?, ?, 1)');
  for (const [name, s] of Object.entries(sample)) {
    const id = ev(name);
    if (!id) continue;
    db.prepare('UPDATE events SET attendance = ?, demo = 1 WHERE id = ? AND attendance IS NULL').run(s.attendance, id);
    for (const [bar, rows] of Object.entries(s.bars)) {
      const barId = Number(insBar.run(id, bar).lastInsertRowid);
      for (const [product, cat, qty, price] of rows) insSale.run(barId, product, cat, qty, Math.round(qty * price * 100));
    }
  }

  // Stock
  const items = [
    ['Pivo Šariš (sud 50 l)', 'alko', 'sud', 6, 4], ['Jägermeister 0,7 l', 'alko', 'fľ.', 14, 10], ['Stock vodka 0,7 l', 'alko', 'fľ.', 5, 8],
    ['Borovička 0,7 l', 'alko', 'fľ.', 9, 5], ['Aperol 0,7 l', 'alko', 'fľ.', 3, 4], ['Prosecco 0,75 l', 'alko', 'fľ.', 12, 6],
    ['Red Bull 0,25 l', 'nealko', 'ks', 240, 120], ['Kofola (sud 50 l)', 'nealko', 'sud', 2, 2], ['Voda 0,5 l', 'nealko', 'ks', 180, 100],
    ['Kelímky 0,5 l', 'nealko', 'bal.', 8, 10]
  ];
  const insItem = db.prepare('INSERT INTO stock_items (name, category, unit, qty, min_qty, demo) VALUES (?, ?, ?, ?, ?, 1)');
  const insMove = db.prepare("INSERT INTO stock_moves (item_id, delta, reason, note, user_id, created_at, demo) VALUES (?, ?, 'purchase', 'Demo starting stock', ?, ?, 1)");
  for (const [name, cat, unit, qty, min] of items) {
    const id = Number(insItem.run(name, cat, unit, qty, min).lastInsertRowid);
    insMove.run(id, qty, adminId || null, now());
  }

  // Promo calendar around Chodbovica 5
  const c5 = ev('Chodbovica 5');
  const promo = [
    ['2026-10-20', '18:00', 'Instagram', 'Oznámenie dátumu Chodbovica 5', 'posted'],
    ['2026-10-27', '18:00', 'Instagram', 'Line-up reveal #1', 'ready'],
    ['2026-10-29', '19:00', 'TikTok', 'Aftermovie Chodbovica 4 (krátka verzia)', 'planned'],
    ['2026-11-02', '10:00', 'Plagáty', 'Plagáty na internátoch Jedlíkova 7 a 9', 'planned'],
    ['2026-11-04', '18:00', 'Instagram', 'Line-up reveal #2 + International Stage', 'planned'],
    ['2026-11-09', '17:00', 'Facebook', 'Event + posledné lístky v predpredaji', 'planned'],
    ['2026-11-12', '12:00', 'Rádio', 'Rádio spot / súťaž o lístky', 'planned'],
    ['2026-11-16', '15:00', 'Instagram', 'Stories: dnes večer o 21:07!', 'planned']
  ];
  const insPromo = db.prepare('INSERT INTO promo (date, time, channel, title, event_id, owner, status, demo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
  for (const [date, time, channel, title, status] of promo) insPromo.run(date, time, channel, title, c5 || null, 'Base team', status);

  // One sample idea
  const ideaId = Number(db.prepare(`INSERT INTO ideas (title, description, why, status, author_id, created_at, demo)
    VALUES (?, ?, ?, 'discussing', ?, ?, 1)`).run(
    'Zimný Chillout v hale',
    'Chillout v zime vo vnútri: house, chill zóny, teplé nápoje, sunset vizuály na LED stene.',
    'Medzi májom a septembrom je dlhá pauza, ľudia sa pýtajú na ďalší Chillout.',
    adminId || null, now()).lastInsertRowid);
  const insPoint = db.prepare('INSERT INTO idea_points (idea_id, kind, text, author_id, created_at) VALUES (?, ?, ?, ?, ?)');
  insPoint.run(ideaId, 'plus', 'Udržíme komunitu aj cez zimu', adminId || null, now());
  insPoint.run(ideaId, 'plus', 'Partneri (Red Bull) majú záujem o zimné aktivácie', adminId || null, now());
  insPoint.run(ideaId, 'minus', 'Prenájom haly je drahší ako open-air', adminId || null, now());
  insPoint.run(ideaId, 'minus', 'Stratí sa „sunset“ atmosféra', adminId || null, now());
}
