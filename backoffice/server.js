// BASE Hub — internal back office for Base Presents (prototype, runs locally).
//   Ticket sales (Stripe TEST mode or demo payment), door scanner, stock, promo calendar,
//   event & bar stats, event ideas, team accounts.
// Run: npm start  →  http://localhost:4242

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import Stripe from 'stripe';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { registerTickets } from './tickets.js';
import { registerHub } from './hub.js';
import { seedRealEvents, loadDemo, removeDemo, hasDemo } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

// ---- Config (.env) ----
const PORT = Number(process.env.PORT || 4242);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const EVENT = {
  name: process.env.EVENT_NAME || 'Chodbovica 5',
  date: process.env.EVENT_DATE || '16.11.2026 · 21:07',
  venue: process.env.EVENT_VENUE || 'Jedlíkova 7, Košice',
  ticketName: process.env.TICKET_NAME || 'Presale',
  priceCents: Number(process.env.TICKET_PRICE_CENTS || 1000),
  capacity: Number(process.env.EVENT_CAPACITY || 1400),
  maxPerOrder: Number(process.env.MAX_PER_ORDER || 6)
};
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
if (STRIPE_KEY && !STRIPE_KEY.startsWith('sk_test_')) {
  console.error('This prototype only runs with a Stripe TEST key (sk_test_...). Refusing to start.');
  process.exit(1);
}
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;
const MODE = stripe ? 'stripe-test' : 'demo';

// ---- Database, accounts, starter data ----
const db = openDb(path.join(__dirname, 'data'));
const auth = createAuth(db, { secureCookies: BASE_URL.startsWith('https://') });

const accounts = [
  { email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME || 'Base admin', role: 'admin', password: process.env.ADMIN_PASSWORD },
  { email: process.env.TICKETS_EMAIL, name: process.env.TICKETS_NAME || 'Lístky', role: 'tickets', password: process.env.TICKETS_PASSWORD },
  { email: process.env.STAFF_EMAIL, name: process.env.STAFF_NAME || 'Base staff', role: 'team', password: process.env.STAFF_PASSWORD }
];
accounts.forEach(auth.seedUser);
if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
  console.warn('No admin account yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in backoffice/.env and restart.');
}
if (seedRealEvents(db)) {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  loadDemo(db, admin?.id);
  console.log('Fresh database: added real events from the BASE report + DEMO numbers (remove them in Admin → Users & data).');
}

// ---- App ----
const app = express();
app.disable('x-powered-by');

const registerTicketJson = registerTickets(app, {
  db, auth, stripe, mode: MODE, event: EVENT, baseUrl: BASE_URL, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
}); // registers the raw-body Stripe webhook first

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

app.get('/', (req, res) => res.redirect('/buy'));

// Login
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.get('/api/me', auth.me);

registerTicketJson();
registerHub(app, { db, auth });

// Demo data (admin)
app.get('/api/demo', auth.requireSection('users'), (req, res) => res.json({ demo: hasDemo(db) }));
app.post('/api/demo/remove', auth.requireSection('users'), (req, res) => { removeDemo(db); res.json({ ok: true }); });
app.post('/api/demo/load', auth.requireSection('users'), (req, res) => {
  if (hasDemo(db)) return res.status(400).json({ error: 'Demo data is already loaded.' });
  loadDemo(db, req.user.id); res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`BASE Hub → ${BASE_URL}  (payments: ${MODE})`);
  console.log(`  Team login: ${BASE_URL}/login     Public ticket shop: ${BASE_URL}/buy`);
});
