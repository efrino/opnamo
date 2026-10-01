import { Router } from 'express';
import { all, one } from '../db.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { HttpError, str, email, password, id } from '../util.js';

const r = Router();
r.use(requireAdmin);

r.get('/', async (req, res) => {
  res.json(await all('SELECT id, name, email, role, active, created_at FROM users WHERE company_id = $1 ORDER BY created_at', [req.user.company_id]));
});

r.post('/', async (req, res) => {
  const name = str(req.body.name, 'Nama', { max: 120 }), mail = email(req.body.email), pass = password(req.body.password);
  const role = req.body.role === 'admin' ? 'admin' : 'counter';
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [mail])) throw new HttpError(409, 'Email sudah dipakai.');
  const u = await one(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, active, created_at`, [req.user.company_id, name, mail, await hashPassword(pass), role]);
  res.status(201).json(u);
});

r.patch('/:id', async (req, res) => {
  const uid = id(req.params.id);
  if (uid === req.user.id && (req.body.active === false || req.body.role === 'counter')) throw new HttpError(400, 'Anda tidak bisa menonaktifkan atau menurunkan akun sendiri.');
  const sets = [], vals = [];
  if (typeof req.body.active === 'boolean') { vals.push(req.body.active); sets.push(`active = $${vals.length}`); }
  if (req.body.role === 'admin' || req.body.role === 'counter') { vals.push(req.body.role); sets.push(`role = $${vals.length}`); }
  if (req.body.password) { vals.push(await hashPassword(password(req.body.password))); sets.push(`password_hash = $${vals.length}`); }
  if (!sets.length) throw new HttpError(400, 'Tidak ada perubahan.');
  vals.push(uid, req.user.company_id);
  const u = await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND company_id = $${vals.length}
    RETURNING id, name, email, role, active, created_at`, vals);
  if (!u) throw new HttpError(404, 'User tidak ditemukan.');
  if (req.body.active === false) await one('DELETE FROM sessions WHERE user_id = $1', [uid]);
  res.json(u);
});

export default r;
