import { get, post } from '../api.js';
import { esc, fmtDate, modal, toast } from '../ui.js';

export async function render(root, { me, go }) {
  const [sts, locs] = await Promise.all([get('/stocktakes'), get('/locations')]);
  root.innerHTML = `
    <div class="page-head"><div><h1>Stok opname</h1><p>Sesi penghitungan fisik</p></div>
      ${me.role === 'admin' ? '<button class="btn primary" id="new">＋ Sesi baru</button>' : ''}</div>
    <div class="list">${sts.length ? sts.map(s => `
      <a class="card" href="/app/stocktakes/${s.id}" style="display:grid;gap:10px">
        <div class="row" style="justify-content:space-between"><b style="font-size:17px">${esc(s.name)}</b>
          <span class="badge ${s.status === 'open' ? 'ok' : ''}">${s.status === 'open' ? '● Berjalan' : s.applied ? 'Selesai · diterapkan' : 'Ditutup'}</span></div>
        <div class="progress"><i style="width:${s.total_items ? s.counted_items / s.total_items * 100 : 0}%"></i></div>
        <div class="row muted" style="justify-content:space-between;font-size:13px">
          <span>${esc(s.location || 'Semua lokasi')} · ${s.counted_items}/${s.total_items} barang · ${s.entries} scan</span><span>${fmtDate(s.created_at)}</span></div>
      </a>`).join('') : `<div class="empty"><b>Belum ada sesi opname</b>${me.role === 'admin' ? 'Klik "Sesi baru" untuk memulai.' : 'Minta admin membuat sesi opname.'}</div>`}</div>`;

  root.querySelector('#new')?.addEventListener('click', async () => {
    const month = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const s = await modal({
      title: 'Sesi opname baru', submit: 'Buat sesi',
      body: `<label class="field"><span>Nama sesi</span><input class="input" name="name" required maxlength="120" value="Opname ${esc(month)}"></label>
        <label class="field"><span>Lokasi yang dihitung</span><select class="input" name="location_id"><option value="">Semua lokasi</option>${locs.map(l => `<option value="${l.id}">${esc(l.name)} (${l.items} barang)</option>`).join('')}</select></label>
        <p class="muted" style="font-size:14px">Qty sistem saat ini akan dibandingkan dengan hasil hitung fisik.</p>`,
      onSubmit: b => post('/stocktakes', b),
    });
    if (s) { toast('Sesi dibuat'); go(`/app/stocktakes/${s.id}`); }
  });
}
