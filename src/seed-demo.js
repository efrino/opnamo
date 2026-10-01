import { one, q, tx } from './db.js';
import { hashPassword } from './auth.js';

export const DEMO_EMAIL = 'demo@opnamo.id';
export const DEMO_PASSWORD = 'demo12345';

const ITEMS = [
  ['SMN-001', 'Semen Tiga Roda 50kg', 'sak', 65000, 120, 'Gudang Utama'], ['SMN-002', 'Semen Gresik 40kg', 'sak', 58000, 80, 'Gudang Utama'],
  ['CAT-010', 'Cat Tembok Putih 5kg', 'pail', 145000, 36, 'Gudang Utama'], ['CAT-011', 'Cat Kayu Hitam 1kg', 'kaleng', 62000, 48, 'Toko Depan'],
  ['BSI-100', 'Besi Beton 10mm 12m', 'batang', 98000, 200, 'Gudang Belakang'], ['BSI-080', 'Besi Beton 8mm 12m', 'batang', 64000, 260, 'Gudang Belakang'],
  ['PPA-050', 'Pipa PVC 1/2" 4m', 'batang', 32000, 150, 'Gudang Belakang'], ['PPA-075', 'Pipa PVC 3/4" 4m', 'batang', 41000, 90, 'Gudang Belakang'],
  ['KRM-030', 'Keramik 30x30 Putih', 'dus', 54000, 75, 'Gudang Utama'], ['KRM-040', 'Keramik 40x40 Motif', 'dus', 72000, 60, 'Gudang Utama'],
  ['PKU-005', 'Paku 5cm', 'kg', 21000, 40, 'Toko Depan'], ['PKU-010', 'Paku 10cm', 'kg', 21000, 35, 'Toko Depan'],
  ['KWT-001', 'Kawat Bendrat', 'roll', 28000, 22, 'Toko Depan'], ['TRP-001', 'Triplek 9mm', 'lembar', 115000, 45, 'Gudang Belakang'],
  ['GNT-001', 'Genteng Metal Pasir', 'lembar', 38000, 300, 'Gudang Belakang'], ['LEM-001', 'Lem Pipa PVC 100g', 'tube', 12500, 64, 'Toko Depan'],
];

// Recreates the demo company from scratch so visitors always see a clean, realistic dataset.
export async function seedDemo() {
  const old = await one('SELECT company_id FROM users WHERE lower(email) = $1', [DEMO_EMAIL]);
  if (old) await q('DELETE FROM companies WHERE id = $1', [old.company_id]);
  const hash = await hashPassword(DEMO_PASSWORD);
  await tx(async c => {
    const co = (await c.query(`INSERT INTO companies (name, plan, trial_ends) VALUES ('Toko Bangunan Maju Jaya (Demo)', 'demo', now() + interval '100 years') RETURNING id`)).rows[0].id;
    const admin = (await c.query(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, 'Demo Admin', $2, $3, 'admin') RETURNING id`, [co, DEMO_EMAIL, hash])).rows[0].id;
    const locs = {};
    for (const n of ['Gudang Utama', 'Gudang Belakang', 'Toko Depan']) locs[n] = (await c.query('INSERT INTO locations (company_id, name) VALUES ($1, $2) RETURNING id', [co, n])).rows[0].id;
    const ids = [];
    for (const [sku, name, unit, price, qty, loc] of ITEMS) {
      ids.push((await c.query('INSERT INTO items (company_id, sku, name, unit, price, system_qty, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [co, sku, name, unit, price, qty, locs[loc]])).rows[0].id);
    }
    const st = (await c.query(`INSERT INTO stocktakes (company_id, name, created_by) VALUES ($1, 'Opname Akhir Bulan', $2) RETURNING id`, [co, admin])).rows[0].id;
    // A partly-finished count with a few realistic discrepancies.
    const counted = [[0, 118], [1, 80], [2, 34], [4, 200], [5, 255], [8, 75], [9, 61], [10, 38.5], [13, 45], [14, 296]];
    for (const [i, qty] of counted) {
      await c.query(`INSERT INTO count_entries (stocktake_id, item_id, qty, counted_by, client_id) VALUES ($1, $2, $3, $4, gen_random_uuid())`, [st, ids[i], qty, admin]);
    }
  });
}
