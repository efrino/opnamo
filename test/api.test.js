// Integration tests against a real Postgres (DATABASE_URL). Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { createApp } from '../src/server.js';
import { migrate, pool } from '../src/db.js';
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from '../src/seed-demo.js';

let server, base;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seedDemo();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  const call = async (method, url, body, { raw = false, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'x-requested-with': 'opnamo', ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return { get: u => call('GET', u), post: (u, b, o) => call('POST', u, b, o), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u), call };
}

const uniq = () => crypto.randomBytes(4).toString('hex');
async function newCompany() {
  const c = client(), email = `owner-${uniq()}@test.id`;
  const r = await c.post('/api/auth/register', { company: 'PT Uji ' + uniq(), name: 'Owner', email, password: 'rahasia123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { c, email };
}

test('register, me, logout, login', async () => {
  const { c, email } = await newCompany();
  const me = await c.get('/api/auth/me');
  assert.equal(me.body.role, 'admin'); assert.equal(me.body.plan, 'trial');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.post('/api/auth/login', { email, password: 'salah-salah' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: email.toUpperCase(), password: 'rahasia123' })).status, 200);
  assert.equal((await c.post('/api/auth/register', { company: 'X', name: 'Y', email, password: 'rahasia123' })).status, 409);
});

test('validation and CSRF', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { company: 'A', name: 'B', email: 'bukan-email', password: 'rahasia123' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { company: 'A', name: 'B', email: 'a@b.id', password: 'pendek' })).status, 400);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403, 'POST without the custom header must be rejected');
});

test('full stock-take flow with idempotent sync and variance report', async () => {
  const { c } = await newCompany();
  const locs = (await c.get('/api/locations')).body;
  const loc = locs[0].id;
  const a = (await c.post('/api/items', { sku: 'A-1', name: 'Barang A', price: 1000, system_qty: 10, location_id: loc })).body;
  const b = (await c.post('/api/items', { sku: 'B-1', name: 'Barang B', price: 500, system_qty: 4, location_id: loc })).body;
  await c.post('/api/items', { sku: 'C-1', name: 'Barang C', price: 100, system_qty: 1, location_id: loc });
  assert.equal((await c.post('/api/items', { sku: 'A-1', name: 'dup' })).status, 409);

  const tags = (await c.post('/api/tags', { items: [{ item_id: a.id, copies: 2 }] })).body;
  assert.equal(tags.length, 2); assert.match(tags[0].code, /^[2-9A-Z]{8}$/);
  assert.equal((await c.get(`/api/tags/lookup/OPN:${tags[0].code}`)).body.sku, 'A-1');
  assert.equal((await c.get('/api/tags/lookup/b-1')).body.via, 'sku');

  const st = (await c.post('/api/stocktakes', { name: 'Uji', location_id: loc })).body;
  const cat = (await c.get(`/api/stocktakes/${st.id}/catalog`)).body;
  assert.equal(cat.items.length, 3); assert.equal(cat.items.find(i => i.sku === 'A-1').tags.length, 2);
  const e1 = crypto.randomUUID();
  const entries = [
    { client_id: e1, code: `OPN:${tags[0].code}`, qty: 6 },
    { client_id: crypto.randomUUID(), code: tags[1].code, qty: 5 },
    { client_id: crypto.randomUUID(), code: 'B-1', qty: 3 },
    { client_id: crypto.randomUUID(), code: 'TIDAK-ADA', qty: 1 },
  ];
  const sync = (await c.post(`/api/stocktakes/${st.id}/entries`, { entries })).body;
  assert.equal(sync.accepted.length, 3); assert.equal(sync.rejected.length, 1);
  // Re-sending the same batch (offline retry) must not double count.
  await c.post(`/api/stocktakes/${st.id}/entries`, { entries });

  const rep = (await c.get(`/api/stocktakes/${st.id}/report`)).body;
  const row = s => rep.rows.find(r => r.sku === s);
  assert.equal(row('A-1').counted, 11); assert.equal(row('A-1').variance, 1); assert.equal(row('A-1').variance_value, 1000);
  assert.equal(row('B-1').variance, -1); assert.equal(row('B-1').variance_value, -500);
  assert.equal(row('C-1').counted, null);
  assert.deepEqual([rep.summary.items, rep.summary.counted, rep.summary.over, rep.summary.short], [3, 2, 1, 1]);

  const xlsx = await c.get(`/api/stocktakes/${st.id}/report.xlsx`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx.body);
  assert.equal(wb.worksheets[0].rowCount, 4);

  assert.equal((await c.post(`/api/stocktakes/${st.id}/apply`)).status, 409, 'must close first');
  await c.post(`/api/stocktakes/${st.id}/close`);
  assert.equal((await c.post(`/api/stocktakes/${st.id}/entries`, { entries: [{ client_id: crypto.randomUUID(), code: 'B-1', qty: 1 }] })).status, 409);
  assert.equal((await c.post(`/api/stocktakes/${st.id}/apply`)).body.updated, 2);
  const items = (await c.get('/api/items')).body.rows;
  assert.equal(items.find(i => i.sku === 'A-1').system_qty, 11);
  assert.equal(items.find(i => i.sku === 'C-1').system_qty, 1, 'uncounted items keep their quantity');
  assert.equal((await c.post(`/api/stocktakes/${st.id}/reopen`)).status, 409);
});

test('tenant isolation: company B cannot see or touch company A data', async () => {
  const A = (await newCompany()).c, B = (await newCompany()).c;
  const item = (await A.post('/api/items', { sku: 'RAHASIA', name: 'Milik A', system_qty: 5 })).body;
  const tag = (await A.post('/api/tags', { items: [{ item_id: item.id }] })).body[0];
  const st = (await A.post('/api/stocktakes', { name: 'A' })).body;
  const locA = (await A.get('/api/locations')).body[0].id;

  assert.equal((await B.get('/api/items?q=RAHASIA')).body.total, 0);
  assert.equal((await B.put(`/api/items/${item.id}`, { sku: 'X', name: 'X' })).status, 404);
  assert.equal((await B.del(`/api/items/${item.id}`)).status, 404);
  assert.equal((await B.get(`/api/tags/lookup/${tag.code}`)).status, 404);
  assert.equal((await B.post('/api/tags', { items: [{ item_id: item.id }] })).status, 400);
  assert.equal((await B.get(`/api/stocktakes/${st.id}`)).status, 404);
  assert.equal((await B.get(`/api/stocktakes/${st.id}/report`)).status, 404);
  assert.equal((await B.post('/api/items', { sku: 'Z', name: 'Z', location_id: locA })).status, 400, 'cannot attach to foreign location');
  // B scanning A's tag inside B's own stocktake must be rejected.
  const stB = (await B.post('/api/stocktakes', { name: 'B' })).body;
  const r = (await B.post(`/api/stocktakes/${stB.id}/entries`, { entries: [{ client_id: crypto.randomUUID(), code: tag.code, qty: 1 }] })).body;
  assert.equal(r.accepted.length, 0);
  assert.equal((await A.get('/api/items')).body.rows[0].system_qty, 5);
});

test('roles: counter can scan but not manage', async () => {
  const { c: admin } = await newCompany();
  const email = `counter-${uniq()}@test.id`;
  assert.equal((await admin.post('/api/users', { name: 'Penghitung', email, password: 'hitung1234', role: 'counter' })).status, 201);
  await admin.post('/api/items', { sku: 'K-1', name: 'K', system_qty: 2 });
  const st = (await admin.post('/api/stocktakes', { name: 'Shift pagi' })).body;
  const ctr = client();
  await ctr.post('/api/auth/login', { email, password: 'hitung1234' });
  assert.equal((await ctr.post('/api/items', { sku: 'K-2', name: 'K2' })).status, 403);
  assert.equal((await ctr.get('/api/users')).status, 403);
  assert.equal((await ctr.post(`/api/stocktakes/${st.id}/close`)).status, 403);
  const r = (await ctr.post(`/api/stocktakes/${st.id}/entries`, { entries: [{ client_id: crypto.randomUUID(), code: 'K-1', qty: 2 }] })).body;
  assert.equal(r.accepted.length, 1);
  // Deactivated users are logged out immediately.
  const uid = (await admin.get('/api/users')).body.find(u => u.email === email).id;
  await admin.call('PATCH', `/api/users/${uid}`, { active: false });
  assert.equal((await ctr.get('/api/auth/me')).status, 401);
});

test('excel import upserts by SKU and creates locations', async () => {
  const { c } = await newCompany();
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('x');
  ws.addRow(['SKU', 'Nama Barang', 'Satuan', 'Harga', 'Qty Sistem', 'Lokasi']);
  ws.addRow(['IMP-1', 'Impor Satu', 'pcs', 1500, 7, 'Rak A']);
  ws.addRow(['IMP-2', 'Impor Dua', 'box', 2500, 3, 'Rak B']);
  ws.addRow(['', 'Tanpa SKU', '', '', '', '']);
  const buf = await wb.xlsx.writeBuffer();
  const r1 = (await c.post('/api/items/import', buf, { raw: true, headers: { 'content-type': 'application/octet-stream' } })).body;
  assert.deepEqual([r1.created, r1.updated, r1.skipped], [2, 0, 1]);
  ws.getRow(2).getCell(5).value = 99;
  const r2 = (await c.post('/api/items/import', await wb.xlsx.writeBuffer(), { raw: true, headers: { 'content-type': 'application/octet-stream' } })).body;
  assert.deepEqual([r2.created, r2.updated], [0, 2]);
  assert.equal((await c.get('/api/items?q=IMP-1')).body.rows[0].system_qty, 99);
  assert.ok((await c.get('/api/locations')).body.some(l => l.name === 'Rak B'));
  assert.equal((await c.post('/api/items/import', Buffer.from('bukan excel'), { raw: true, headers: { 'content-type': 'application/octet-stream' } })).status, 400);
});

test('demo account works and expired trials become read-only', async () => {
  const d = client();
  assert.equal((await d.post('/api/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status, 200);
  const sts = (await d.get('/api/stocktakes')).body;
  assert.equal(sts[0].counted_items, 10);
  const { c } = await newCompany();
  const me = (await c.get('/api/auth/me')).body;
  await pool.query(`UPDATE companies SET trial_ends = now() - interval '1 day' WHERE id = $1`, [me.company_id]);
  assert.equal((await c.post('/api/items', { sku: 'T', name: 'T' })).status, 402);
  assert.equal((await c.get('/api/items')).status, 200);
});
