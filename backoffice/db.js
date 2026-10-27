// SQLite database (built into Node 22) and shared helpers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'base.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- Team accounts
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,                 -- admin | tickets | team
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    -- Ticket sales
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      qty INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,               -- pending | paid | expired | failed
      mode TEXT NOT NULL,                 -- demo | stripe-test
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

    -- Events (shared by stats, stock movements and promo)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series TEXT NOT NULL,               -- Chodbovica | Chillout | Other
      edition TEXT,
      name TEXT NOT NULL,
      date TEXT,                          -- YYYY-MM-DD
      venue TEXT,
      attendance INTEGER,
      notes TEXT,
      demo INTEGER NOT NULL DEFAULT 0     -- 1 = sample numbers, removable
    );
    CREATE TABLE IF NOT EXISTS bars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bar_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bar_id INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
      product TEXT NOT NULL,
      category TEXT NOT NULL,             -- alko | nealko
      qty REAL NOT NULL,
      revenue_cents INTEGER NOT NULL DEFAULT 0,
      demo INTEGER NOT NULL DEFAULT 0
    );

    -- Stock (sklad)
    CREATE TABLE IF NOT EXISTS stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,             -- alko | nealko
      unit TEXT NOT NULL,                 -- ks, fľ., sud, bal., l
      qty REAL NOT NULL DEFAULT 0,
      min_qty REAL NOT NULL DEFAULT 0,
      note TEXT,
      demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,               -- purchase | event | loss | correction
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      note TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0
    );

    -- Promo calendar
    CREATE TABLE IF NOT EXISTS promo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,                 -- YYYY-MM-DD
      time TEXT,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'planned', -- planned | ready | posted
      note TEXT,
      demo INTEGER NOT NULL DEFAULT 0
    );

    -- Event ideas
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      why TEXT,
      status TEXT NOT NULL DEFAULT 'new',  -- new | discussing | approved | rejected
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS idea_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                 -- plus | minus
      text TEXT NOT NULL,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idea_votes (
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,             -- 1 or -1
      PRIMARY KEY (idea_id, user_id)
    );

    -- Staff planning: one sheet per day, people per group with the hours they are there
    CREATE TABLE IF NOT EXISTS staff_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,                 -- YYYY-MM-DD
      title TEXT NOT NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES staff_days(id) ON DELETE CASCADE,
      grp TEXT NOT NULL,                  -- Prep | Bar | Radio | anything else
      person TEXT NOT NULL,
      hours TEXT NOT NULL DEFAULT '',     -- comma list of start hours, 7..25 (25 = 01:00)
      note TEXT,
      sort INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Columns added after the first version (safe to run on every start)
  addColumn(db, 'stock_items', 'volume_l', 'REAL');
  addColumn(db, 'stock_items', 'unit_price_cents', 'INTEGER');
  addColumn(db, 'stock_moves', 'unit_price_cents', 'INTEGER');
  addColumn(db, 'stock_moves', 'source', 'TEXT');           // supplier / who brought it
  addColumn(db, 'stock_moves', 'deal', "TEXT NOT NULL DEFAULT 'normal'"); // normal | komis | free
  return db;
}

function addColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export const now = () => Date.now();
export const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Input helpers: trim + cap length; return null for empty
export const str = (v, max = 200) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s === '' ? null : s;
};
export const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
