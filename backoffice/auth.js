// Team accounts, password hashing, login sessions and role checks.
import crypto from 'node:crypto';
import { now, randomId } from './db.js';

export const ROLES = {
  admin: 'Admin',
  tickets: 'Ticket sales',
  team: 'Team'
};

// Which roles can open which section
export const ACCESS = {
  tickets: ['admin', 'tickets'],
  stock: ['admin', 'team'],
  promo: ['admin', 'tickets', 'team'],
  stats: ['admin', 'team'],
  ideas: ['admin', 'tickets', 'team'],
  users: ['admin']
};

const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password, stored) {
  const [kind, saltB64, hashB64] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const hash = Buffer.from(hashB64, 'base64');
  const test = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), hash.length);
  return crypto.timingSafeEqual(hash, test);
}

// A fixed hash to compare against when the email is unknown, so timing does not reveal valid emails
const DUMMY_HASH = hashPassword(randomId());

export function createAuth(db, { secureCookies }) {
  const cookieName = 'bp_session';

  function seedUser({ email, name, role, password }) {
    if (!email || !password) return;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (exists) return;
    db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email.toLowerCase(), name, role, hashPassword(password), now());
    console.log(`Created ${ROLES[role]} account: ${email.toLowerCase()}`);
  }

  function tokenFrom(req) {
    const m = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`).exec(req.get('cookie') || '');
    return m ? m[1] : '';
  }

  function currentUser(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s
                            JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
    if (!row) return null;
    if (row.expires_at < now()) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return null; }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }

  function cookie(token, maxAge) {
    return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  }

  // Slow down password guessing: max 10 failed attempts per IP per 15 minutes
  const failed = new Map();
  const blocked = (ip) => { const f = failed.get(ip); return f && now() - f.since < 15 * 60000 && f.n >= 10; };
  const fail = (ip) => {
    const f = failed.get(ip);
    if (!f || now() - f.since > 15 * 60000) failed.set(ip, { n: 1, since: now() }); else f.n += 1;
  };

  function login(req, res) {
    const ip = req.ip;
    if (blocked(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = checkPassword(String(req.body.password || ''), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) { fail(ip); return res.status(401).json({ error: 'Wrong email or password.' }); }
    failed.delete(ip);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    const token = randomId(24);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, now() + SESSION_HOURS * 3600000);
    res.set('Set-Cookie', cookie(token, SESSION_HOURS * 3600));
    res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
  }

  function logout(req, res) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenFrom(req));
    res.set('Set-Cookie', cookie('', 0));
    res.json({ ok: true });
  }

  // Middleware: must be logged in and (optionally) allowed into a section
  function requireSection(section) {
    return (req, res, next) => {
      const user = currentUser(req);
      if (!user) return res.status(401).json({ error: 'Please log in', result: 'auth', message: 'Please log in' });
      if (section && !ACCESS[section].includes(user.role)) {
        return res.status(403).json({ error: 'You do not have access to this section', result: 'auth', message: 'No access' });
      }
      req.user = user;
      next();
    };
  }

  function me(req, res) {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    const sections = Object.keys(ACCESS).filter((s) => ACCESS[s].includes(user.role));
    res.json({ ...user, roleName: ROLES[user.role], sections });
  }

  return { seedUser, currentUser, requireSection, login, logout, me };
}
