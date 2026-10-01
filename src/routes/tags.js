import { Router } from 'express';
import crypto from 'node:crypto';
import { all, one, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, id, num } from '../util.js';

const r = Router();
// Crockford-style alphabet: no 0/O/1/I confusion when typed by hand.
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPHA[b % 32]).join('');

const TAG_COLS = `t.code, t.item_id, i.sku, i.name, i.unit, coalesce(tl.name, il.name) AS location`;
const TAG_FROM = `FROM tags t JOIN items i ON i.id = t.item_id LEFT JOIN locations tl ON tl.id = t.location_id LEFT JOIN locations il ON il.id = i.location_id`;

r.get('/', async (req, res) => {
  const vals = [req.user.company_id]; let where = 't.company_id = $1';
  if (req.query.item_id) { vals.push(id(req.query.item_id)); where += ` AND t.item_id = $2`; }
  res.json(await all(`SELECT ${TAG_COLS} ${TAG_FROM} WHERE ${where} ORDER BY i.sku, t.created_at LIMIT 2000`, vals));
});

// Body: { items: [{ item_id, copies }] } -> newly created tags for printing.
r.post('/', requireAdmin, async (req, res) => {
  const list = Array.isArray(req.body.items) ? req.body.items : [];
  if (!list.length) throw new HttpError(400, 'Pilih minimal satu barang.');
  const want = list.map(x => ({ item_id: id(x.item_id, 'Barang'), copies: num(x.copies ?? 1, 'Jumlah tag', { min: 1, max: 500 }) | 0 }));
  if (want.reduce((s, x) => s + x.copies, 0) > 2000) throw new HttpError(400, 'Maksimal 2.000 tag sekali cetak.');
  const ids = want.map(x => x.item_id);
  const owned = await all('SELECT id, location_id FROM items WHERE company_id = $1 AND id = ANY($2)', [req.user.company_id, ids]);
  if (owned.length !== new Set(ids).size) throw new HttpError(400, 'Ada barang yang tidak ditemukan.');
  const locOf = new Map(owned.map(o => [o.id, o.location_id]));
  const codes = await tx(async c => {
    const out = [];
    for (const w of want) for (let k = 0; k < w.copies; k++) {
      const code = newCode();
      await c.query('INSERT INTO tags (code, company_id, item_id, location_id) VALUES ($1, $2, $3, $4)', [code, req.user.company_id, w.item_id, locOf.get(w.item_id)]);
      out.push(code);
    }
    return out;
  });
  res.status(201).json(await all(`SELECT ${TAG_COLS} ${TAG_FROM} WHERE t.code = ANY($1) ORDER BY i.sku`, [codes]));
});

// Resolve a scanned value: our QR ("OPN:CODE"), a bare tag code, or a product barcode/SKU.
export async function resolveScan(companyId, raw) {
  const v = String(raw || '').trim().replace(/^OPN:/i, '');
  if (!v || v.length > 80) return null;
  const tag = await one(`SELECT ${TAG_COLS}, i.system_qty ${TAG_FROM} WHERE t.company_id = $1 AND t.code = $2`, [companyId, v.toUpperCase()]);
  if (tag) return { ...tag, via: 'tag' };
  const item = await one(`SELECT NULL AS code, i.id AS item_id, i.sku, i.name, i.unit, l.name AS location, i.system_qty
    FROM items i LEFT JOIN locations l ON l.id = i.location_id WHERE i.company_id = $1 AND lower(i.sku) = lower($2)`, [companyId, v]);
  return item ? { ...item, via: 'sku' } : null;
}

r.get('/lookup/:code', async (req, res) => {
  const hit = await resolveScan(req.user.company_id, req.params.code);
  if (!hit) throw new HttpError(404, 'Tag/SKU tidak dikenal.');
  res.json(hit);
});

export default r;
