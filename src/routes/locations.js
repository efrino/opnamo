import { Router } from 'express';
import { all, one } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, str, id } from '../util.js';

const r = Router();

r.get('/', async (req, res) => {
  res.json(await all(`SELECT l.id, l.name, count(i.id)::int AS items FROM locations l
    LEFT JOIN items i ON i.location_id = l.id WHERE l.company_id = $1 GROUP BY l.id ORDER BY l.name`, [req.user.company_id]));
});

r.post('/', requireAdmin, async (req, res) => {
  const name = str(req.body.name, 'Nama lokasi', { max: 80 });
  const l = await one(`INSERT INTO locations (company_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name`, [req.user.company_id, name]);
  if (!l) throw new HttpError(409, 'Lokasi dengan nama itu sudah ada.');
  res.status(201).json({ ...l, items: 0 });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const l = await one('DELETE FROM locations WHERE id = $1 AND company_id = $2 RETURNING id', [id(req.params.id), req.user.company_id]);
  if (!l) throw new HttpError(404, 'Lokasi tidak ditemukan.');
  res.json({ ok: true });
});

export default r;
