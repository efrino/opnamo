import { Router } from 'express';
import express from 'express';
import ExcelJS from 'exceljs';
import { all, one, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, str, optStr, num, id } from '../util.js';

const r = Router();

// A location id from the client must belong to the caller's company.
export async function ownLocation(companyId, v) {
  if (v === undefined || v === null || v === '') return null;
  const l = await one('SELECT id FROM locations WHERE id = $1 AND company_id = $2', [id(v, 'Lokasi'), companyId]);
  if (!l) throw new HttpError(400, 'Lokasi tidak ditemukan.');
  return l.id;
}

const COLS = `i.id, i.sku, i.name, i.unit, i.price, i.system_qty, i.location_id, l.name AS location,
  (SELECT count(*)::int FROM tags t WHERE t.item_id = i.id) AS tags`;

r.get('/', async (req, res) => {
  const vals = [req.user.company_id], where = ['i.company_id = $1'];
  if (req.query.q) { vals.push(`%${String(req.query.q).slice(0, 80)}%`); where.push(`(i.sku ILIKE $${vals.length} OR i.name ILIKE $${vals.length})`); }
  if (req.query.location_id) { vals.push(id(req.query.location_id)); where.push(`i.location_id = $${vals.length}`); }
  const limit = Math.min(Number(req.query.limit) || 100, 500), offset = Math.max(Number(req.query.offset) || 0, 0);
  const [rows, total] = await Promise.all([
    all(`SELECT ${COLS} FROM items i LEFT JOIN locations l ON l.id = i.location_id WHERE ${where.join(' AND ')} ORDER BY i.sku LIMIT ${limit} OFFSET ${offset}`, vals),
    one(`SELECT count(*)::int AS n FROM items i WHERE ${where.join(' AND ')}`, vals),
  ]);
  res.json({ rows, total: total.n });
});

function itemBody(b) {
  return {
    sku: str(b.sku, 'SKU', { max: 60 }),
    name: str(b.name, 'Nama barang', { max: 160 }),
    unit: optStr(b.unit, 'Satuan', { max: 20 }) || 'pcs',
    price: b.price === undefined || b.price === '' ? 0 : num(b.price, 'Harga'),
    system_qty: b.system_qty === undefined || b.system_qty === '' ? 0 : num(b.system_qty, 'Qty sistem'),
  };
}

r.post('/', requireAdmin, async (req, res) => {
  const b = itemBody(req.body), loc = await ownLocation(req.user.company_id, req.body.location_id);
  const it = await one(`INSERT INTO items (company_id, sku, name, unit, price, system_qty, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (company_id, sku) DO NOTHING RETURNING id`, [req.user.company_id, b.sku, b.name, b.unit, b.price, b.system_qty, loc]);
  if (!it) throw new HttpError(409, `SKU ${b.sku} sudah ada.`);
  res.status(201).json(await one(`SELECT ${COLS} FROM items i LEFT JOIN locations l ON l.id = i.location_id WHERE i.id = $1`, [it.id]));
});

r.put('/:id', requireAdmin, async (req, res) => {
  const b = itemBody(req.body), loc = await ownLocation(req.user.company_id, req.body.location_id);
  try {
    const it = await one(`UPDATE items SET sku=$1, name=$2, unit=$3, price=$4, system_qty=$5, location_id=$6 WHERE id=$7 AND company_id=$8 RETURNING id`,
      [b.sku, b.name, b.unit, b.price, b.system_qty, loc, id(req.params.id), req.user.company_id]);
    if (!it) throw new HttpError(404, 'Barang tidak ditemukan.');
  } catch (e) { if (e.code === '23505') throw new HttpError(409, `SKU ${b.sku} sudah dipakai barang lain.`); throw e; }
  res.json(await one(`SELECT ${COLS} FROM items i LEFT JOIN locations l ON l.id = i.location_id WHERE i.id = $1`, [id(req.params.id)]));
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const it = await one('DELETE FROM items WHERE id = $1 AND company_id = $2 RETURNING id', [id(req.params.id), req.user.company_id]);
  if (!it) throw new HttpError(404, 'Barang tidak ditemukan.');
  res.json({ ok: true });
});

const HEADERS = ['SKU', 'Nama Barang', 'Satuan', 'Harga', 'Qty Sistem', 'Lokasi'];

r.get('/template.xlsx', async (req, res) => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Barang');
  ws.columns = HEADERS.map((h, i) => ({ header: h, width: [14, 34, 10, 14, 12, 18][i] }));
  ws.addRow(['BRG-001', 'Semen Tiga Roda 50kg', 'sak', 65000, 120, 'Gudang Utama']);
  ws.addRow(['BRG-002', 'Cat Tembok Putih 5kg', 'pail', 145000, 36, 'Gudang Utama']);
  ws.getRow(1).font = { bold: true };
  res.attachment('template-barang-opnamo.xlsx');
  await wb.xlsx.write(res);
});

// Upsert items by SKU from an .xlsx upload; unknown locations are created.
r.post('/import', requireAdmin, express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.body); } catch { throw new HttpError(400, 'File harus berformat .xlsx (Excel).'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'Sheet kosong.');
  const head = (ws.getRow(1).values || []).slice(1).map(v => String(v ?? '').trim().toLowerCase());
  const col = name => head.findIndex(h => h.startsWith(name)) + 1;
  const c = { sku: col('sku'), name: col('nama'), unit: col('satuan'), price: col('harga'), qty: col('qty'), loc: col('lokasi') };
  if (!c.sku || !c.name) throw new HttpError(400, 'Kolom "SKU" dan "Nama Barang" wajib ada di baris pertama.');
  const cell = (row, i) => { if (!i) return undefined; const v = row.getCell(i).value; return v && typeof v === 'object' ? (v.result ?? v.text ?? '') : v; };

  const rows = [], errors = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    try {
      const b = itemBody({ sku: String(cell(row, c.sku) ?? ''), name: String(cell(row, c.name) ?? ''), unit: cell(row, c.unit) ? String(cell(row, c.unit)) : '', price: cell(row, c.price) ?? '', system_qty: cell(row, c.qty) ?? '' });
      rows.push({ ...b, loc: cell(row, c.loc) ? String(cell(row, c.loc)).trim().slice(0, 80) : null });
    } catch (e) { if (errors.length < 20) errors.push(`Baris ${n}: ${e.message}`); }
  });
  if (rows.length > 20000) throw new HttpError(400, 'Maksimal 20.000 baris per impor.');

  const result = await tx(async db => {
    const locs = new Map((await db.query('SELECT id, name FROM locations WHERE company_id = $1', [req.user.company_id])).rows.map(l => [l.name.toLowerCase(), l.id]));
    let created = 0, updated = 0;
    for (const b of rows) {
      let locId = null;
      if (b.loc) {
        locId = locs.get(b.loc.toLowerCase());
        if (!locId) { locId = (await db.query('INSERT INTO locations (company_id, name) VALUES ($1, $2) RETURNING id', [req.user.company_id, b.loc])).rows[0].id; locs.set(b.loc.toLowerCase(), locId); }
      }
      const x = (await db.query(`INSERT INTO items (company_id, sku, name, unit, price, system_qty, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (company_id, sku) DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit, price=EXCLUDED.price, system_qty=EXCLUDED.system_qty, location_id=COALESCE(EXCLUDED.location_id, items.location_id)
        RETURNING (xmax = 0) AS inserted`, [req.user.company_id, b.sku, b.name, b.unit, b.price, b.system_qty, locId])).rows[0];
      x.inserted ? created++ : updated++;
    }
    return { created, updated };
  });
  res.json({ ...result, skipped: errors.length, errors });
});

export default r;
