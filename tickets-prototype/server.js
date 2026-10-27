// Base Presents — ticket sales prototype (Stripe TEST mode only).
// Run: npm start  →  http://localhost:4242
// Without STRIPE_SECRET_KEY it runs in DEMO mode with a simulated payment page.

import dotenv from 'dotenv';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';
import QRCode from 'qrcode';

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
// Staff login for /admin and /scan (prototype: one shared account from .env)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'base@base.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'base-test-2026';
const SESSION_HOURS = 12;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const HOLD_MINUTES = 30; // Stripe Checkout sessions live at least 30 min; seats are held that long

if (STRIPE_KEY && !STRIPE_KEY.startsWith('sk_test_')) {
  console.error('This prototype only runs with a Stripe TEST key (sk_test_...). Refusing to start.');
  process.exit(1);
}
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;
const MODE = stripe ? 'stripe-test' : 'demo';

// ---- Database ----
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'tickets.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    qty INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL,              -- pending | paid | expired | failed
    mode TEXT NOT NULL,                -- demo | stripe-test
    stripe_session_id TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    code TEXT NOT NULL UNIQUE,
    holder TEXT NOT NULL,
    checked_in_at INTEGER
  );
`);

const now = () => Date.now();
const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');
// Ticket codes: 12 chars, no look-alike characters, shown as XXXX-XXXX-XXXX
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function ticketCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Seats taken = paid tickets + pending orders still inside their hold window
function seatsTaken() {
  const row = db.prepare(`
    SELECT COALESCE(SUM(qty), 0) AS n FROM orders
    WHERE status = 'paid' OR (status = 'pending' AND created_at > ?)
  `).get(now() - (HOLD_MINUTES + 1) * 60000);
  return Number(row.n);
}

// Mark an order paid and issue its tickets. Safe to call more than once.
function fulfill(orderId) {
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.status === 'paid') return order;
    db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now(), orderId);
    const ins = db.prepare('INSERT INTO tickets (order_id, code, holder) VALUES (?, ?, ?)');
    for (let i = 0; i < order.qty; i++) ins.run(orderId, ticketCode(), order.name);
    console.log(`[email simulation] ${order.qty} ticket(s) for ${order.email}: ${BASE_URL}/order/${order.id}?t=${order.access_token}`);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
// ---- Staff sessions (in memory: a server restart logs everyone out) ----
const sessions = new Map(); // token -> expiresAt
const sameText = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const cookieToken = (req) => {
  const m = /(?:^|;\s*)bp_session=([^;]+)/.exec(req.get('cookie') || '');
  return m ? m[1] : '';
};
const staffOk = (req) => {
  const token = cookieToken(req);
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < now()) { sessions.delete(token); return false; }
  return true;
};
// Slow down password guessing: max 10 failed attempts per IP per 15 minutes
const failed = new Map(); // ip -> { n, since }
function tooManyAttempts(ip) {
  const f = failed.get(ip);
  if (!f || now() - f.since > 15 * 60000) return false;
  return f.n >= 10;
}
function noteFailure(ip) {
  const f = failed.get(ip);
  if (!f || now() - f.since > 15 * 60000) failed.set(ip, { n: 1, since: now() });
  else f.n += 1;
}

// ---- App ----
const app = express();
app.disable('x-powered-by');

// Stripe webhook needs the raw body, so it is registered before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(400).send('Stripe not configured');
  let event;
  try {
    event = WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), WEBHOOK_SECRET)
      : null;
  } catch (e) {
    return res.status(400).send(`Webhook signature error: ${e.message}`);
  }
  if (!event) return res.status(400).send('STRIPE_WEBHOOK_SECRET not set');
  const s = event.data.object;
  const orderId = s.metadata && s.metadata.order_id;
  if (orderId) {
    if (event.type === 'checkout.session.completed' && s.payment_status === 'paid') fulfill(orderId);
    if (event.type === 'checkout.session.expired') {
      db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'").run(orderId);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

app.get('/', (req, res) => res.redirect('/buy'));

// Public event info for the buy page
app.get('/api/event', (req, res) => {
  const remaining = Math.max(0, EVENT.capacity - seatsTaken());
  res.json({ ...EVENT, remaining, mode: MODE });
});

// Start a purchase
app.post('/api/checkout', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const qty = Number(req.body.qty);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!Number.isInteger(qty) || qty < 1 || qty > EVENT.maxPerOrder) {
    return res.status(400).json({ error: `You can buy 1–${EVENT.maxPerOrder} tickets per order.` });
  }

  // Reserve seats atomically
  let order;
  try {
    order = transaction(() => {
      if (EVENT.capacity - seatsTaken() < qty) throw Object.assign(new Error('soldout'), { soldOut: true });
      const o = {
        id: randomId(9), access_token: randomId(18), name, email, qty,
        amount_cents: qty * EVENT.priceCents, status: 'pending', mode: MODE, created_at: now()
      };
      db.prepare(`INSERT INTO orders (id, access_token, name, email, qty, amount_cents, status, mode, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(o.id, o.access_token, o.name, o.email, o.qty, o.amount_cents, o.status, o.mode, o.created_at);
      return o;
    });
  } catch (e) {
    if (e.soldOut) return res.status(409).json({ error: 'Sorry, not enough tickets left.' });
    throw e;
  }

  if (!stripe) return res.json({ url: `/demo-checkout/${order.id}?t=${order.access_token}` });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        quantity: qty,
        price_data: {
          currency: 'eur',
          unit_amount: EVENT.priceCents,
          product_data: { name: `${EVENT.name} — ${EVENT.ticketName}`, description: `${EVENT.date} · ${EVENT.venue}` }
        }
      }],
      metadata: { order_id: order.id },
      expires_at: Math.floor(now() / 1000) + HOLD_MINUTES * 60,
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/buy?canceled=1`
    });
    db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, order.id);
    res.json({ url: session.url });
  } catch (e) {
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(order.id);
    console.error('Stripe error:', e.message);
    res.status(502).json({ error: 'Payment could not be started. Try again.' });
  }
});

// Stripe redirects here after payment. We double-check with Stripe before issuing tickets.
app.get('/success', async (req, res) => {
  if (!stripe) return res.redirect('/buy');
  try {
    const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(session.id);
    if (!order) return res.status(404).send(page('Order not found', '<p>We could not find this order.</p>'));
    if (session.payment_status !== 'paid') {
      return res.send(page('Payment pending', '<p>Your payment is not confirmed yet. Refresh this page in a moment.</p>'));
    }
    fulfill(order.id);
    res.redirect(`/order/${order.id}?t=${order.access_token}`);
  } catch (e) {
    res.status(400).send(page('Something went wrong', `<p>${esc(e.message)}</p>`));
  }
});

// DEMO mode: a fake payment page standing in for Stripe Checkout
app.get('/demo-checkout/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND access_token = ?').get(req.params.id, String(req.query.t || ''));
  if (!order || MODE !== 'demo') return res.status(404).send(page('Not found', '<p>Order not found.</p>'));
  if (order.status === 'paid') return res.redirect(`/order/${order.id}?t=${order.access_token}`);
  res.send(page('Payment (simulation)', `
    <div class="card">
      <span class="label">Demo payment · no real money</span>
      <h2>${esc(EVENT.name)} — ${esc(EVENT.ticketName)}</h2>
      <p class="muted">${order.qty} × ${eur(EVENT.priceCents)} · ${esc(order.email)}</p>
      <p class="total">${eur(order.amount_cents)}</p>
      <p class="muted">In the real version this is Stripe's secure card page.
        Add a Stripe test key to <code>.env</code> to see it.</p>
      <form method="post" action="/demo-checkout/${order.id}/pay?t=${order.access_token}">
        <button class="btn" type="submit"><span>Pay ${eur(order.amount_cents)} (simulated)</span><span>→</span></button>
      </form>
      <a class="link" href="/buy?canceled=1">Cancel</a>
    </div>`));
});

app.post('/demo-checkout/:id/pay', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND access_token = ?').get(req.params.id, String(req.query.t || ''));
  if (!order || MODE !== 'demo') return res.status(404).send(page('Not found', '<p>Order not found.</p>'));
  fulfill(order.id);
  res.redirect(`/order/${order.id}?t=${order.access_token}`);
});

// The buyer's tickets (this link would be emailed)
app.get('/order/:id', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND access_token = ?').get(req.params.id, String(req.query.t || ''));
  if (!order || order.status !== 'paid') return res.status(404).send(page('Not found', '<p>Order not found.</p>'));
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_id = ? ORDER BY id').all(order.id);
  const cards = await Promise.all(tickets.map(async (t, i) => {
    const svg = await QRCode.toString(t.code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
    return `
      <article class="ticket">
        <div class="ticket-head">
          <span class="label">Ticket ${i + 1} / ${tickets.length}</span>
          <span class="label">${t.checked_in_at ? 'Used' : 'Valid'}</span>
        </div>
        <h2>${esc(EVENT.name)}</h2>
        <p class="muted">${esc(EVENT.date)} · ${esc(EVENT.venue)}</p>
        <div class="qr">${svg}</div>
        <p class="code">${t.code}</p>
        <p class="muted">${esc(t.holder)} · ${esc(EVENT.ticketName)}</p>
      </article>`;
  }));
  res.send(page('Your tickets', `
    <p class="lead">Thanks, ${esc(order.name)}! Show the QR code at the door.</p>
    <p class="muted">Order ${order.id} · ${eur(order.amount_cents)} · ${order.mode === 'demo' ? 'demo payment' : 'Stripe test payment'}.
      In the real version this page is also sent to <b>${esc(order.email)}</b>.</p>
    <div class="tickets">${cards.join('')}</div>`));
});

// Staff login / logout
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const ok = sameText(email, ADMIN_EMAIL) & sameText(password, ADMIN_PASSWORD); // no short-circuit on purpose
  if (!ok) { noteFailure(ip); return res.status(401).json({ error: 'Wrong email or password.' }); }
  failed.delete(ip);
  const token = randomId(24);
  sessions.set(token, now() + SESSION_HOURS * 3600000);
  const secure = BASE_URL.startsWith('https://') ? '; Secure' : '';
  res.set('Set-Cookie', `bp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  res.json({ ok: true, email: ADMIN_EMAIL });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(cookieToken(req));
  res.set('Set-Cookie', 'bp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!staffOk(req)) return res.status(401).json({ error: 'Not logged in' });
  res.json({ email: ADMIN_EMAIL });
});

// Door check-in (staff only)
app.post('/api/checkin', (req, res) => {
  if (!staffOk(req)) return res.status(401).json({ result: 'auth', message: 'Please log in' });
  const code = normCode(req.body.code);
  const out = transaction(() => {
    const t = db.prepare(`SELECT t.*, o.status FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.code = ?`).get(code);
    if (!t || t.status !== 'paid') return { result: 'invalid', message: 'Unknown ticket', code };
    if (t.checked_in_at) {
      return { result: 'used', message: `Already used at ${new Date(t.checked_in_at).toLocaleTimeString('sk-SK')}`, holder: t.holder, code };
    }
    db.prepare('UPDATE tickets SET checked_in_at = ? WHERE id = ?').run(now(), t.id);
    return { result: 'ok', message: 'Welcome!', holder: t.holder, code };
  });
  res.json(out);
});

// Sales overview (staff only)
app.get('/api/admin/summary', (req, res) => {
  if (!staffOk(req)) return res.status(401).json({ error: 'Please log in' });
  const sold = db.prepare("SELECT COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id WHERE o.status = 'paid'").get().n;
  const checkedIn = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE checked_in_at IS NOT NULL').get().n;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM orders WHERE status = 'paid'").get().c;
  const orders = db.prepare(`SELECT id, access_token, name, email, qty, amount_cents, status, mode, created_at, paid_at
                             FROM orders ORDER BY created_at DESC LIMIT 200`).all();
  res.json({
    event: EVENT, mode: MODE, sold: Number(sold), checkedIn: Number(checkedIn), revenueCents: Number(revenue),
    remaining: Math.max(0, EVENT.capacity - seatsTaken()),
    orders: orders.map((o) => ({ ...o, link: o.status === 'paid' ? `/order/${o.id}?t=${o.access_token}` : null, access_token: undefined }))
  });
});

// Simple page shell for server-rendered pages
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Base Presents</title>
<link rel="icon" href="/assets/favicon-32.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/style.css"></head><body>
<header class="top"><a href="/buy"><img src="/assets/base-logo-white.png" alt="Base Presents" height="22"></a>
${MODE === 'demo' ? '<span class="badge">Demo mode</span>' : '<span class="badge">Stripe test mode</span>'}</header>
<main class="wrap"><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Base Presents tickets prototype → ${BASE_URL}  (mode: ${MODE})`);
  console.log(`  Buy:     ${BASE_URL}/buy`);
  console.log(`  Scanner: ${BASE_URL}/scan   Admin: ${BASE_URL}/admin   (staff login: ${ADMIN_EMAIL})`);
});
