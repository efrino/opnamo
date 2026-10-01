import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one, tx } from '../db.js';
import { startSession, endSession, hashPassword, checkPassword, requireUser } from '../auth.js';
import { HttpError, str, email, password } from '../util.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' } });

r.post('/register', limiter, async (req, res) => {
  const company = str(req.body.company, 'Nama perusahaan', { max: 120 });
  const name = str(req.body.name, 'Nama', { max: 120 });
  const mail = email(req.body.email), pass = password(req.body.password);
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [mail])) throw new HttpError(409, 'Email sudah terdaftar. Silakan login.');
  const hash = await hashPassword(pass);
  const user = await tx(async c => {
    const co = (await c.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [company])).rows[0];
    await c.query('INSERT INTO locations (company_id, name) VALUES ($1, $2)', [co.id, 'Gudang Utama']);
    return (await c.query(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`, [co.id, name, mail, hash])).rows[0];
  });
  await startSession(res, user.id);
  res.status(201).json({ ok: true });
});

r.post('/login', limiter, async (req, res) => {
  const mail = email(req.body.email);
  const u = await one('SELECT id, password_hash, active FROM users WHERE lower(email) = $1', [mail]);
  // Same message for unknown email and wrong password.
  if (!u || !u.active || !(await checkPassword(String(req.body.password || ''), u.password_hash))) throw new HttpError(401, 'Email atau password salah.');
  await startSession(res, u.id);
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => { await endSession(req, res); res.json({ ok: true }); });

r.get('/me', requireUser, (req, res) => res.json(req.user));

export default r;
