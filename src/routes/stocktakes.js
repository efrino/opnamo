import { Router } from 'express';
import ExcelJS from 'exceljs';
import { all, one, q, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, str, num, id, optStr } from '../util.js';
import { ownLocation } from './items.js';
import { resolveScan } from './tags.js';

const r = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getStocktake(req, sid = req.params.id) {
  const s = await one(`SELECT s.*, l.name AS location FROM stocktakes s LEFT JOIN locations l ON l.id = s.location_id
    WHERE s.id = $1 AND s.company_id = $2`, [id(sid), req.user.company_id]);
  if (!s) throw new HttpError(404, 'Sesi opname tidak ditemukan.');
  return s;
}

// Items in scope: the stocktake's location, or every item if none was chosen.
const SCOPE = `i.company_id = s.company_id AND (s.location_id IS NULL OR i.location_id = s.location_id)`;

const PROGRESS = `
  (SELECT count(*)::int FROM items i WHERE ${SCOPE}) AS total_items,
  (SELECT count(DISTINCT e.item_id)::int FROM count_entries e WHERE e.stocktake_id = s.id AND NOT e.voided) AS counted_items,
  (SELECT count(*)::int FROM count_entries e WHERE e.stocktake_id = s.id AND NOT e.voided) AS entries`;

r.get('/', async (req, res) => {
  res.json(await all(`SELECT s.id, s.name, s.status, s.applied, s.created_at, s.closed_at, l.name AS location, ${PROGRESS}
    FROM stocktakes s LEFT JOIN locations l ON l.id = s.location_id WHERE s.company_id = $1 ORDER BY s.created_at DESC LIMIT 100`, [req.user.company_id]));
});

r.post('/', requireAdmin, async (req, res) => {
  const name = str(req.body.name, 'Nama sesi', { max: 120 });
  const loc = await ownLocation(req.user.company_id, req.body.location_id);
  const s = await one('INSERT INTO stocktakes (company_id, name, location_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [req.user.company_id, name, loc, req.user.id]);
  res.status(201).json(s);
});

r.get('/:id', async (req, res) => {
  const s = await getStocktake(req);
  res.json({ ...s, ...(await one(`SELECT ${PROGRESS} FROM stocktakes s WHERE s.id = $1`, [s.id])) });
});

// Compact item + tag dictionary so the PWA can resolve scans while offline.
r.get('/:id/catalog', async (req, res) => {
  const s = await getStocktake(req);
  const items = await all(`SELECT i.id, i.sku, i.name, i.unit, i.system_qty, l.name AS location,
      coalesce((SELECT array_agg(t.code) FROM tags t WHERE t.item_id = i.id), '{}') AS tags
    FROM stocktakes s JOIN items i ON ${SCOPE} LEFT JOIN locations l ON l.id = i.location_id WHERE s.id = $1`, [s.id]);
  res.json({ stocktake: { id: s.id, name: s.name, status: s.status, location: s.location }, items, at: new Date().toISOString() });
});

// Batch upload of scans (also used for offline sync). Idempotent per client_id.
r.post('/:id/entries', async (req, res) => {
  const s = await getStocktake(req);
  if (s.status !== 'open') throw new HttpError(409, 'Sesi opname sudah ditutup.');
  const list = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 500) : [];
  const accepted = [], rejected = [];
  for (const e of list) {
    const cid = String(e.client_id || '');
    try {
      if (!UUID.test(cid)) throw new HttpError(400, 'client_id tidak valid.');
      const qty = num(e.qty, 'Qty', { min: 0, max: 1e9 });
      const hit = await resolveScan(req.user.company_id, e.code);
      if (!hit) throw new HttpError(404, `Tag/SKU "${String(e.code).slice(0, 40)}" tidak dikenal.`);
      const at = e.counted_at && !Number.isNaN(Date.parse(e.counted_at)) ? new Date(e.counted_at) : new Date();
      await q(`INSERT INTO count_entries (stocktake_id, item_id, tag_code, qty, note, counted_by, counted_at, client_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (client_id) DO NOTHING`,
        [s.id, hit.item_id, hit.code, qty, optStr(e.note, 'Catatan', { max: 200 }), req.user.id, at, cid]);
      accepted.push(cid);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      rejected.push({ client_id: cid, error: err.message });
    }
  }
  res.json({ accepted, rejected });
});

r.get('/:id/entries', async (req, res) => {
  const s = await getStocktake(req);
  const vals = [s.id]; let where = 'e.stocktake_id = $1';
  if (req.query.mine) { vals.push(req.user.id); where += ' AND e.counted_by = $2'; }
  res.json(await all(`SELECT e.id, e.qty, e.note, e.tag_code, e.counted_at, e.voided, e.client_id, i.sku, i.name, i.unit, u.name AS counted_by
    FROM count_entries e JOIN items i ON i.id = e.item_id LEFT JOIN users u ON u.id = e.counted_by
    WHERE ${where} ORDER BY e.counted_at DESC LIMIT ${Math.min(Number(req.query.limit) || 50, 500)}`, vals));
});

r.post('/:id/entries/:eid/void', requireAdmin, async (req, res) => {
  const s = await getStocktake(req);
  if (s.status !== 'open') throw new HttpError(409, 'Sesi sudah ditutup.');
  const e = await one('UPDATE count_entries SET voided = NOT voided WHERE id = $1 AND stocktake_id = $2 RETURNING id, voided', [id(req.params.eid), s.id]);
  if (!e) throw new HttpError(404, 'Entri tidak ditemukan.');
  res.json(e);
});

async function report(s) {
  return all(`SELECT i.id, i.sku, i.name, i.unit, i.price, i.system_qty, l.name AS location,
      c.counted, c.entries,
      CASE WHEN c.counted IS NULL THEN NULL ELSE c.counted - i.system_qty END AS variance,
      CASE WHEN c.counted IS NULL THEN NULL ELSE (c.counted - i.system_qty) * i.price END AS variance_value
    FROM stocktakes s JOIN items i ON ${SCOPE}
    LEFT JOIN locations l ON l.id = i.location_id
    LEFT JOIN LATERAL (SELECT sum(e.qty) AS counted, count(*)::int AS entries FROM count_entries e
      WHERE e.stocktake_id = s.id AND e.item_id = i.id AND NOT e.voided) c ON c.entries > 0
    WHERE s.id = $1 ORDER BY abs(coalesce((c.counted - i.system_qty) * i.price, 0)) DESC, i.sku`, [s.id]);
}

r.get('/:id/report', async (req, res) => {
  const s = await getStocktake(req);
  const rows = await report(s);
  const counted = rows.filter(r => r.counted !== null);
  res.json({
    stocktake: s, rows,
    summary: {
      items: rows.length, counted: counted.length,
      matched: counted.filter(r => r.variance === 0).length,
      over: counted.filter(r => r.variance > 0).length,
      short: counted.filter(r => r.variance < 0).length,
      value_over: counted.reduce((a, r) => a + Math.max(0, r.variance_value), 0),
      value_short: counted.reduce((a, r) => a + Math.min(0, r.variance_value), 0),
    },
  });
});

r.get('/:id/report.xlsx', async (req, res) => {
  const s = await getStocktake(req);
  const rows = await report(s);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Opnamo';
  const ws = wb.addWorksheet('Selisih');
  ws.columns = [
    { header: 'SKU', key: 'sku', width: 14 }, { header: 'Nama Barang', key: 'name', width: 34 }, { header: 'Lokasi', key: 'location', width: 16 },
    { header: 'Satuan', key: 'unit', width: 8 }, { header: 'Qty Sistem', key: 'system_qty', width: 12 }, { header: 'Qty Fisik', key: 'counted', width: 12 },
    { header: 'Selisih', key: 'variance', width: 10 }, { header: 'Harga', key: 'price', width: 14, style: { numFmt: '#,##0' } },
    { header: 'Nilai Selisih', key: 'variance_value', width: 16, style: { numFmt: '#,##0;[Red]-#,##0' } }, { header: 'Status', key: 'status', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const x of rows) ws.addRow({ ...x, status: x.counted === null ? 'Belum dihitung' : x.variance === 0 ? 'Sesuai' : x.variance > 0 ? 'Lebih' : 'Kurang' });
  ws.autoFilter = { from: 'A1', to: 'J1' }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  const safe = s.name.replace(/[^\w\- ]+/g, '_').slice(0, 60);
  res.attachment(`opname-${safe}.xlsx`);
  await wb.xlsx.write(res);
});

r.post('/:id/close', requireAdmin, async (req, res) => {
  const s = await getStocktake(req);
  if (s.status === 'closed') throw new HttpError(409, 'Sesi sudah ditutup.');
  await q(`UPDATE stocktakes SET status = 'closed', closed_at = now() WHERE id = $1`, [s.id]);
  res.json({ ok: true });
});

r.post('/:id/reopen', requireAdmin, async (req, res) => {
  const s = await getStocktake(req);
  if (s.applied) throw new HttpError(409, 'Hasil sudah diterapkan ke stok sistem, sesi tidak bisa dibuka lagi.');
  await q(`UPDATE stocktakes SET status = 'open', closed_at = NULL WHERE id = $1`, [s.id]);
  res.json({ ok: true });
});

// Overwrite system_qty with counted qty for every counted item. One-way.
r.post('/:id/apply', requireAdmin, async (req, res) => {
  const s = await getStocktake(req);
  if (s.status !== 'closed') throw new HttpError(409, 'Tutup sesi dulu sebelum menerapkan hasil.');
  if (s.applied) throw new HttpError(409, 'Hasil sudah pernah diterapkan.');
  const n = await tx(async c => {
    const u = await c.query(`UPDATE items i SET system_qty = c.counted FROM (
        SELECT item_id, sum(qty) AS counted FROM count_entries WHERE stocktake_id = $1 AND NOT voided GROUP BY item_id) c
      WHERE i.id = c.item_id AND i.company_id = $2`, [s.id, req.user.company_id]);
    await c.query('UPDATE stocktakes SET applied = true WHERE id = $1', [s.id]);
    return u.rowCount;
  });
  res.json({ ok: true, updated: n });
});

export default r;
