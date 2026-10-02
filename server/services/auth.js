/**
 * Minimal cookie-token sessions for the admin dashboard. PIN only, no usernames.
 * Tokens are random, stored server-side in SQLite, and expire.
 */
import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { config } from '../config.js';

const COOKIE_NAME = 'kiosk_admin';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyPin(pin) {
  const supplied = crypto.createHash('sha256').update(String(pin ?? ''), 'utf8').digest('hex');
  return safeEqual(supplied, config.adminPinSha256);
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = config.sessionTtlHours * 3600 * 1000;
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(token, now, now + ttl);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now); // opportunistic cleanup
  return { token, maxAgeSec: Math.floor(ttl / 1000) };
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function isValidSession(token) {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  return !!row && row.expires_at > Date.now();
}

export function parseCookie(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function tokenFromRequest(req) {
  return parseCookie(req.headers.cookie ?? '')[COOKIE_NAME];
}

/** Express middleware */
export function requireAdmin(req, res, next) {
  if (isValidSession(tokenFromRequest(req))) return next();
  res.status(401).json({ error: 'unauthorized' });
}
