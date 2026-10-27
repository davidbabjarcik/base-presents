// Ticket sales: buy page API, Stripe Checkout (test mode) or demo payment, QR tickets, door check-in.
import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { now, randomId, transaction } from './db.js';
import { page, esc, eur } from './page.js';

// Ticket codes: 12 chars, no look-alike characters, shown as XXXX-XXXX-XXXX
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function ticketCode() {
  let s = '';
  for (const b of crypto.randomBytes(12)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');

const HOLD_MINUTES = 30; // Stripe Checkout sessions live at least 30 min; seats are held that long

export function registerTickets(app, { db, auth, stripe, mode, event, baseUrl, webhookSecret }) {
  const shell = (title, body) => page(title, body, mode);

  // Seats taken = paid tickets + pending orders still inside their hold window
  function seatsTaken() {
    const row = db.prepare(`SELECT COALESCE(SUM(qty), 0) AS n FROM orders
      WHERE status = 'paid' OR (status = 'pending' AND created_at > ?)`).get(now() - (HOLD_MINUTES + 1) * 60000);
    return Number(row.n);
  }

  // Mark an order paid and issue its tickets. Safe to call more than once.
  function fulfill(orderId) {
    return transaction(db, () => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new Error('Order not found');
      if (order.status === 'paid') return order;
      db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now(), orderId);
      const ins = db.prepare('INSERT INTO tickets (order_id, code, holder) VALUES (?, ?, ?)');
      for (let i = 0; i < order.qty; i++) ins.run(orderId, ticketCode(), order.name);
      console.log(`[email simulation] ${order.qty} ticket(s) for ${order.email}: ${baseUrl}/order/${order.id}?t=${order.access_token}`);
      return order;
    });
  }

  // Stripe webhook (raw body). Registered by server.js before express.json().
  app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe || !webhookSecret) return res.status(400).send('Webhook not configured');
    let ev;
    try { ev = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), webhookSecret); }
    catch (e) { return res.status(400).send(`Webhook signature error: ${e.message}`); }
    const s = ev.data.object;
    const orderId = s.metadata && s.metadata.order_id;
    if (orderId && ev.type === 'checkout.session.completed' && s.payment_status === 'paid') fulfill(orderId);
    if (orderId && ev.type === 'checkout.session.expired') {
      db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'").run(orderId);
    }
    res.json({ received: true });
  });

  return function registerJsonRoutes() {
    app.get('/api/event', (req, res) => {
      res.json({ ...event, remaining: Math.max(0, event.capacity - seatsTaken()), mode });
    });

    app.post('/api/checkout', async (req, res) => {
      const name = String(req.body.name || '').trim().slice(0, 80);
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
      const qty = Number(req.body.qty);
      if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
      if (!Number.isInteger(qty) || qty < 1 || qty > event.maxPerOrder) {
        return res.status(400).json({ error: `You can buy 1–${event.maxPerOrder} tickets per order.` });
      }
      let order;
      try {
        order = transaction(db, () => {
          if (event.capacity - seatsTaken() < qty) throw Object.assign(new Error('soldout'), { soldOut: true });
          const o = { id: randomId(9), access_token: randomId(18), name, email, qty, amount_cents: qty * event.priceCents, created_at: now() };
          db.prepare(`INSERT INTO orders (id, access_token, name, email, qty, amount_cents, status, mode, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
            .run(o.id, o.access_token, o.name, o.email, o.qty, o.amount_cents, mode, o.created_at);
          return o;
        });
      } catch (e) {
        if (e.soldOut) return res.status(409).json({ error: 'Sorry, not enough tickets left.' });
        console.error(e); return res.status(500).json({ error: 'Server error' });
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
              unit_amount: event.priceCents,
              product_data: { name: `${event.name} — ${event.ticketName}`, description: `${event.date} · ${event.venue}` }
            }
          }],
          metadata: { order_id: order.id },
          expires_at: Math.floor(now() / 1000) + HOLD_MINUTES * 60,
          success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/buy?canceled=1`
        });
        db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, order.id);
        res.json({ url: session.url });
      } catch (e) {
        db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(order.id);
        console.error('Stripe error:', e.message);
        res.status(502).json({ error: 'Payment could not be started. Try again.' });
      }
    });

    // Stripe redirects here after payment; we double-check with Stripe before issuing tickets
    app.get('/success', async (req, res) => {
      if (!stripe) return res.redirect('/buy');
      try {
        const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
        const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(session.id);
        if (!order) return res.status(404).send(shell('Order not found', '<p>We could not find this order.</p>'));
        if (session.payment_status !== 'paid') {
          return res.send(shell('Payment pending', '<p>Your payment is not confirmed yet. Refresh this page in a moment.</p>'));
        }
        fulfill(order.id);
        res.redirect(`/order/${order.id}?t=${order.access_token}`);
      } catch (e) {
        res.status(400).send(shell('Something went wrong', `<p>${esc(e.message)}</p>`));
      }
    });

    // DEMO mode: a fake payment page standing in for Stripe Checkout
    const demoOrder = (req) => db.prepare('SELECT * FROM orders WHERE id = ? AND access_token = ?').get(req.params.id, String(req.query.t || ''));
    app.get('/demo-checkout/:id', (req, res) => {
      const order = demoOrder(req);
      if (!order || mode !== 'demo') return res.status(404).send(shell('Not found', '<p>Order not found.</p>'));
      if (order.status === 'paid') return res.redirect(`/order/${order.id}?t=${order.access_token}`);
      res.send(shell('Payment (simulation)', `
        <div class="card">
          <span class="label">Demo payment · no real money</span>
          <h2>${esc(event.name)} — ${esc(event.ticketName)}</h2>
          <p class="muted">${order.qty} × ${eur(event.priceCents)} · ${esc(order.email)}</p>
          <p class="total">${eur(order.amount_cents)}</p>
          <p class="muted">In the real version this is Stripe's secure card page. Add a Stripe test key to <code>.env</code> to see it.</p>
          <form method="post" action="/demo-checkout/${order.id}/pay?t=${order.access_token}">
            <button class="btn" type="submit"><span>Pay ${eur(order.amount_cents)} (simulated)</span><span>→</span></button>
          </form>
          <a class="link" href="/buy?canceled=1">Cancel</a>
        </div>`));
    });
    app.post('/demo-checkout/:id/pay', (req, res) => {
      const order = demoOrder(req);
      if (!order || mode !== 'demo') return res.status(404).send(shell('Not found', '<p>Order not found.</p>'));
      fulfill(order.id);
      res.redirect(`/order/${order.id}?t=${order.access_token}`);
    });

    // The buyer's tickets (this link would be emailed)
    app.get('/order/:id', async (req, res) => {
      const order = demoOrder(req);
      if (!order || order.status !== 'paid') return res.status(404).send(shell('Not found', '<p>Order not found.</p>'));
      const tickets = db.prepare('SELECT * FROM tickets WHERE order_id = ? ORDER BY id').all(order.id);
      const cards = await Promise.all(tickets.map(async (t, i) => {
        const svg = await QRCode.toString(t.code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        return `<article class="ticket">
          <div class="ticket-head"><span class="label">Ticket ${i + 1} / ${tickets.length}</span><span class="label">${t.checked_in_at ? 'Used' : 'Valid'}</span></div>
          <h2>${esc(event.name)}</h2>
          <p class="muted">${esc(event.date)} · ${esc(event.venue)}</p>
          <div class="qr">${svg}</div>
          <p class="code">${t.code}</p>
          <p class="muted">${esc(t.holder)} · ${esc(event.ticketName)}</p>
        </article>`;
      }));
      res.send(shell('Your tickets', `
        <p class="lead">Thanks, ${esc(order.name)}! Show the QR code at the door.</p>
        <p class="muted">Order ${order.id} · ${eur(order.amount_cents)} · ${order.mode === 'demo' ? 'demo payment' : 'Stripe test payment'}.
          In the real version this page is also sent to <b>${esc(order.email)}</b>.</p>
        <div class="tickets">${cards.join('')}</div>`));
    });

    // Door check-in (ticket staff)
    app.post('/api/checkin', auth.requireSection('tickets'), (req, res) => {
      const code = normCode(req.body.code);
      const out = transaction(db, () => {
        const t = db.prepare('SELECT t.*, o.status FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.code = ?').get(code);
        if (!t || t.status !== 'paid') return { result: 'invalid', message: 'Unknown ticket', code };
        if (t.checked_in_at) return { result: 'used', message: `Already used at ${new Date(t.checked_in_at).toLocaleTimeString('sk-SK')}`, holder: t.holder, code };
        db.prepare('UPDATE tickets SET checked_in_at = ? WHERE id = ?').run(now(), t.id);
        return { result: 'ok', message: 'Welcome!', holder: t.holder, code };
      });
      res.json(out);
    });

    // Sales overview (ticket staff)
    app.get('/api/tickets/summary', auth.requireSection('tickets'), (req, res) => {
      const sold = db.prepare("SELECT COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id WHERE o.status = 'paid'").get().n;
      const checkedIn = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE checked_in_at IS NOT NULL').get().n;
      const revenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM orders WHERE status = 'paid'").get().c;
      const orders = db.prepare(`SELECT id, access_token, name, email, qty, amount_cents, status, created_at
                                 FROM orders ORDER BY created_at DESC LIMIT 200`).all();
      res.json({
        event, mode, sold: Number(sold), checkedIn: Number(checkedIn), revenueCents: Number(revenue),
        remaining: Math.max(0, event.capacity - seatsTaken()),
        orders: orders.map(({ access_token, ...o }) => ({ ...o, link: o.status === 'paid' ? `/order/${o.id}?t=${access_token}` : null }))
      });
    });
  };
}
