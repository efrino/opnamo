import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, q } from './db.js';
import { HttpError } from './util.js';

const COOKIE = 'opn_sid';
const TTL_DAYS = 30;
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

export const hashPassword = p => bcrypt.hash(p, 11);
export const checkPassword = (p, h) => bcrypt.compare(p, h);

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${TTL_DAYS} days')`, [hashToken(token), userId]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_DAYS * 86400e3,
  });
}

export async function endSession(req, res) {
  const t = readCookie(req);
  if (t) await q('DELETE FROM sessions WHERE token = $1', [hashToken(t)]);
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Loads req.user (with company) or responds 401.
export async function requireUser(req, res, next) {
  const t = readCookie(req);
  const u = t && await one(`
    SELECT u.id, u.name, u.email, u.role, u.company_id, c.name AS company_name, c.plan, c.trial_ends,
           (c.plan = 'trial' AND c.trial_ends < now()) AS expired
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token = $1 AND s.expires_at > now() AND u.active`, [hashToken(t)]);
  if (!u) throw new HttpError(401, 'Sesi berakhir, silakan login lagi.');
  // Expired trials keep read access so customers can still export their data.
  if (u.expired && req.method !== 'GET') throw new HttpError(402, 'Masa trial berakhir. Hubungi WhatsApp 0851-8408-4989 untuk berlangganan.');
  req.user = u;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang bisa melakukan ini.');
  next();
}

// Custom header can't be sent cross-site without a CORS preflight, which we never allow.
export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'opnamo') throw new HttpError(403, 'Permintaan ditolak.');
  next();
}

export const purgeExpiredSessions = () => q('DELETE FROM sessions WHERE expires_at < now()');
