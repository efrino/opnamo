import { get, post } from '../api.js';
import { esc, fmtNum, fmtRp, fmtDate, signed, toast, confirmBox, $ } from '../ui.js';

export async function render(root, { params: [sid], me, go }) {
  const admin = me.role === 'admin';
  let filter = 'diff', data;
  const load = async () => {
    data = await get(`/stocktakes/${sid}/report`);
    const { stocktake: s, summary: m } = data;
    const pct = m.items ? Math.round(m.counted / m.items * 100) : 0;
    root.innerHTML = `
      <div class="page-head"><div><a class="muted" href="/app/stocktakes" style="font-size:14px">← Semua sesi</a>
        <h1>${esc(s.name)}</h1><p>${esc(s.location || 'Semua lokasi')} · dibuat ${fmtDate(s.created_at)} · <span class="badge ${s.status === 'open' ? 'ok' : ''}">${s.status === 'open' ? '● Berjalan' : s.applied ? 'Diterapkan' : 'Ditutup'}</span></p></div>
        <div class="row">
          ${s.status === 'open' ? `<a class="btn primary" href="/app/scan/${s.id}">📷 Scan</a>` : ''}
          <a class="btn" href="/api/stocktakes/${s.id}/report.xlsx" download>⬇ Excel</a>
          ${admin && s.status === 'open' ? '<button class="btn" id="close">Tutup sesi</button>' : ''}
          ${admin && s.status === 'closed' && !s.applied ? '<button class="btn" id="reopen">Buka lagi</button><button class="btn primary" id="apply">Terapkan ke stok</button>' : ''}
        </div></div>
      <div class="stats">
        <div class="stat"><b>${pct}%</b><span>${m.counted}/${m.items} barang dihitung</span><div class="progress" style="margin-top:8px"><i style="width:${pct}%"></i></div></div>
        <div class="stat"><b class="ok">${m.matched}</b><span>Sesuai</span></div>
        <div class="stat"><b class="bad">${fmtRp(m.value_short)}</b><span>${m.short} barang kurang</span></div>
        <div class="stat"><b class="warn">${fmtRp(m.value_over)}</b><span>${m.over} barang lebih</span></div>
      </div>
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div class="chips" id="flt">${[['diff', 'Selisih'], ['todo', 'Belum dihitung'], ['ok', 'Sesuai'], ['all', 'Semua']].map(([k, t]) => `<button data-k="${k}" class="${k === filter ? 'active' : ''}">${t}</button>`).join('')}</div>
        <input class="input" id="q" type="search" placeholder="Cari…" style="max-width:220px">
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>SKU</th><th>Nama</th><th class="num">Sistem</th><th class="num">Fisik</th><th class="num">Selisih</th><th class="num hide-m">Nilai</th></tr></thead><tbody id="tb"></tbody></table></div>
      ${admin && s.status === 'open' ? '<h2 style="font-size:18px;margin:26px 0 12px">Scan terbaru</h2><div class="list" id="recent"></div>' : ''}`;
    table();
    if (admin && s.status === 'open') recent();
    bind(s);
  };
  const table = () => {
    const q = ($('#q', root)?.value || '').toLowerCase();
    const rows = data.rows.filter(r => (filter === 'all' || (filter === 'todo' ? r.counted === null : filter === 'ok' ? r.variance === 0 : r.variance !== null && r.variance !== 0))
      && (!q || r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
    $('#tb', root).innerHTML = rows.length ? rows.map(r => `<tr>
      <td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="num">${fmtNum(r.system_qty)}</td>
      <td class="num">${r.counted === null ? '<span class="muted">–</span>' : fmtNum(r.counted)}</td>
      <td class="num ${r.variance > 0 ? 'warn' : r.variance < 0 ? 'bad' : r.variance === 0 ? 'ok' : ''}">${r.variance === null ? '' : r.variance === 0 ? '✓' : signed(r.variance)}</td>
      <td class="num hide-m ${r.variance_value < 0 ? 'bad' : ''}">${r.variance ? fmtRp(r.variance_value) : ''}</td></tr>`).join('')
      : '<tr><td colspan="6"><div class="empty" style="border:0">Tidak ada barang di filter ini.</div></td></tr>';
  };
  const recent = async () => {
    const list = await get(`/stocktakes/${sid}/entries?limit=30`);
    $('#recent', root).innerHTML = list.length ? list.map(e => `<div class="entry ${e.voided ? 'void' : ''}">
      <div><b>${esc(e.name)}</b> <span class="muted mono">${esc(e.sku)}</span><div class="muted" style="font-size:12px">${esc(e.counted_by || '')} · ${fmtDate(e.counted_at)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
      <div class="row"><b>${fmtNum(e.qty)} ${esc(e.unit)}</b><button class="btn sm" data-void="${e.id}">${e.voided ? 'Pulihkan' : 'Batalkan'}</button></div></div>`).join('')
      : '<div class="empty">Belum ada scan.</div>';
  };
  const bind = s => {
    $('#flt', root).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.k; $$flt(); table(); });
    const $$flt = () => root.querySelectorAll('#flt button').forEach(x => x.classList.toggle('active', x.dataset.k === filter));
    $('#q', root).addEventListener('input', table);
    $('#close', root)?.addEventListener('click', async () => {
      if (await confirmBox('Tutup sesi?', `${data.summary.items - data.summary.counted} barang belum dihitung. Setelah ditutup, tim tidak bisa scan lagi (bisa dibuka kembali).`, 'Tutup sesi', false)) { await post(`/stocktakes/${s.id}/close`); toast('Sesi ditutup'); load(); }
    });
    $('#reopen', root)?.addEventListener('click', async () => { await post(`/stocktakes/${s.id}/reopen`); toast('Sesi dibuka lagi'); load(); });
    $('#apply', root)?.addEventListener('click', async () => {
      if (!await confirmBox('Terapkan hasil ke stok sistem?', `Qty sistem untuk ${data.summary.counted} barang yang dihitung akan diganti dengan qty fisik. Barang yang belum dihitung tidak berubah. Tindakan ini tidak bisa dibatalkan.`, 'Terapkan')) return;
      const r = await post(`/stocktakes/${s.id}/apply`); toast(`✓ ${r.updated} barang diperbarui`); load();
    });
    $('#recent', root)?.addEventListener('click', async e => {
      const b = e.target.closest('[data-void]'); if (!b) return;
      await post(`/stocktakes/${sid}/entries/${b.dataset.void}/void`); load();
    });
  };
  await load();
}
