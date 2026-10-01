import { get } from '../api.js';
import { esc, fmtNum, fmtRp, fmtDate } from '../ui.js';

export async function render(root, { me }) {
  const [items, sts] = await Promise.all([get('/items?limit=1'), get('/stocktakes')]);
  const open = sts.filter(s => s.status === 'open');
  const last = sts.find(s => s.status === 'closed') || sts[0];
  const rep = last ? await get(`/stocktakes/${last.id}/report`) : null;
  root.innerHTML = `
    <div class="page-head"><div><h1>Halo, ${esc(me.name.split(' ')[0])} 👋</h1><p>${esc(me.company_name)}</p></div>
      ${me.role === 'admin' ? '<a class="btn primary" href="/app/stocktakes">＋ Opname baru</a>' : ''}</div>
    ${!items.total && me.role === 'admin' ? `<div class="card" style="margin-bottom:20px"><h2 style="font-size:20px;margin-bottom:6px">Mulai dalam 3 langkah</h2>
      <ol class="muted" style="padding-left:20px;display:grid;gap:6px"><li><a class="grad" href="/app/items">Impor daftar barang</a> dari Excel (atau tambah manual)</li><li>Cetak tag QR dan tempel di rak/barang</li><li>Buat sesi opname, lalu tim scan pakai HP</li></ol></div>` : ''}
    <div class="stats">
      <div class="stat"><b>${fmtNum(items.total)}</b><span>Barang terdaftar</span></div>
      <div class="stat"><b>${open.length}</b><span>Opname berjalan</span></div>
      ${rep ? `<div class="stat"><b class="${rep.summary.value_short < 0 ? 'bad' : ''}">${fmtRp(rep.summary.value_short)}</b><span>Nilai kurang · ${esc(last.name)}</span></div>
      <div class="stat"><b>${rep.summary.counted ? Math.round(rep.summary.matched / rep.summary.counted * 100) : 0}%</b><span>Akurasi stok (sesuai / dihitung)</span></div>` : ''}
    </div>
    <h2 style="font-size:18px;margin:8px 0 12px">Opname berjalan</h2>
    <div class="list">${open.length ? open.map(s => `
      <a class="card" href="/app/stocktakes/${s.id}" style="display:grid;gap:10px">
        <div class="row" style="justify-content:space-between"><b>${esc(s.name)}</b><span class="badge acc">${esc(s.location || 'Semua lokasi')}</span></div>
        <div class="progress"><i style="width:${s.total_items ? s.counted_items / s.total_items * 100 : 0}%"></i></div>
        <div class="row muted" style="justify-content:space-between;font-size:13px"><span>${s.counted_items}/${s.total_items} barang dihitung</span><span>${fmtDate(s.created_at)}</span></div>
        <span class="btn primary sm" style="justify-self:start">📷 Lanjut scan</span>
      </a>`).join('') : '<div class="empty"><b>Tidak ada opname berjalan</b>Buat sesi opname baru untuk mulai menghitung.</div>'}</div>`;
  // Card links to detail, but the button inside goes straight to the scanner.
  root.querySelectorAll('.card .btn.primary.sm').forEach((b, i) => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); history.pushState({}, '', `/app/scan/${open[i].id}`); dispatchEvent(new PopStateEvent('popstate')); }));
}
