import { get, post, put, del, api } from '../api.js';
import { esc, fmtNum, fmtRp, toast, modal, confirmBox, $ } from '../ui.js';

export async function render(root, { me, go }) {
  const admin = me.role === 'admin';
  let locs = await get('/locations'), q = '', loc = '', rows = [], total = 0, sel = new Set();
  root.innerHTML = `
    <div class="page-head"><div><h1>Barang</h1><p>Master barang & tag QR</p></div>
      ${admin ? `<div class="row"><a class="btn sm" href="/api/items/template.xlsx" download>⬇ Template Excel</a>
        <label class="btn sm" tabindex="0">⬆ Impor Excel<input type="file" accept=".xlsx" id="imp" hidden></label>
        <button class="btn primary sm" id="add">＋ Barang</button></div>` : ''}</div>
    <div class="row" style="margin-bottom:14px">
      <input class="input grow" id="q" type="search" placeholder="Cari SKU atau nama…">
      <select class="input" id="loc" style="width:auto"><option value="">Semua lokasi</option>${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
    </div>
    ${admin ? `<div class="row hidden" id="selbar" style="margin-bottom:12px;padding:10px 14px;border-radius:12px;background:rgba(124,92,255,.12)">
      <b id="selN"></b><span class="grow"></span><button class="btn sm" id="selClear">Batal</button><button class="btn primary sm" id="printSel">🏷️ Cetak tag QR</button></div>` : ''}
    <div class="tbl-wrap"><table><thead><tr>${admin ? '<th style="width:36px"><input type="checkbox" id="all" aria-label="Pilih semua"></th>' : ''}
      <th>SKU</th><th>Nama</th><th class="hide-m">Lokasi</th><th class="num">Qty sistem</th><th class="num hide-m">Harga</th><th class="num hide-m">Tag</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody id="tb"></tbody></table></div>
    <p class="muted mono" style="font-size:12px;margin-top:10px" id="count"></p>`;

  const load = async () => {
    const p = new URLSearchParams({ limit: 500 }); if (q) p.set('q', q); if (loc) p.set('location_id', loc);
    ({ rows, total } = await get('/items?' + p));
    $('#tb', root).innerHTML = rows.length ? rows.map(r => `<tr data-id="${r.id}">
      ${admin ? `<td><input type="checkbox" class="pick" ${sel.has(r.id) ? 'checked' : ''} aria-label="Pilih ${esc(r.sku)}"></td>` : ''}
      <td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="hide-m muted">${esc(r.location || '–')}</td>
      <td class="num">${fmtNum(r.system_qty)} <span class="muted">${esc(r.unit)}</span></td><td class="num hide-m">${fmtRp(r.price)}</td>
      <td class="num hide-m">${r.tags ? `<span class="badge acc">${r.tags}</span>` : '<span class="muted">–</span>'}</td>
      ${admin ? '<td class="num"><button class="btn sm" data-edit>Ubah</button></td>' : ''}</tr>`).join('')
      : `<tr><td colspan="8"><div class="empty" style="border:0"><b>${q || loc ? 'Tidak ditemukan' : 'Belum ada barang'}</b>${admin && !q ? 'Impor dari Excel atau tambah satu per satu.' : ''}</div></td></tr>`;
    $('#count', root).textContent = `${rows.length} dari ${total} barang${total > rows.length ? ' (persempit pencarian untuk melihat sisanya)' : ''}`;
    selbar();
  };
  const selbar = () => {
    if (!admin) return;
    $('#selbar', root).classList.toggle('hidden', !sel.size);
    $('#selN', root).textContent = `${sel.size} barang dipilih`;
    $('#all', root).checked = rows.length && rows.every(r => sel.has(r.id));
  };

  const form = (it = {}) => `
    <div class="grid2"><label class="field"><span>SKU / kode</span><input class="input" name="sku" required maxlength="60" value="${esc(it.sku)}"></label>
      <label class="field"><span>Satuan</span><input class="input" name="unit" maxlength="20" value="${esc(it.unit || 'pcs')}"></label></div>
    <label class="field"><span>Nama barang</span><input class="input" name="name" required maxlength="160" value="${esc(it.name)}"></label>
    <div class="grid2"><label class="field"><span>Qty sistem</span><input class="input" name="system_qty" inputmode="decimal" value="${it.system_qty ?? 0}"></label>
      <label class="field"><span>Harga satuan (Rp)</span><input class="input" name="price" inputmode="decimal" value="${it.price ?? 0}"></label></div>
    <label class="field"><span>Lokasi</span><select class="input" name="location_id"><option value="">–</option>${locs.map(l => `<option value="${l.id}" ${l.id === it.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`;

  $('#q', root).addEventListener('input', e => { clearTimeout(load.t); load.t = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); });
  $('#loc', root).addEventListener('change', e => { loc = e.target.value; load(); });
  load();
  if (admin) {
    $('#add', root).addEventListener('click', async () => {
      if (await modal({ title: 'Tambah barang', body: form({ location_id: locs[0]?.id }), onSubmit: b => post('/items', b) })) { toast('Barang ditambahkan'); load(); }
    });
    $('#tb', root).addEventListener('click', async e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const it = rows.find(r => r.id === +tr.dataset.id);
      if (e.target.closest('.pick')) { e.target.checked ? sel.add(it.id) : sel.delete(it.id); return selbar(); }
      if (!e.target.closest('[data-edit]')) return;
      const r = await modal({ title: `Ubah ${it.sku}`, body: form(it) + '<button type="button" class="btn danger sm" data-del style="justify-self:start">Hapus barang</button>',
        onSubmit: b => put(`/items/${it.id}`, b) });
      if (r) { toast('Tersimpan'); load(); }
    });
    document.addEventListener('click', delHandler);
    async function delHandler(e) {
      if (!e.target.closest('[data-del]')) return;
      const form = e.target.closest('form'); const sku = form.querySelector('[name=sku]').value;
      const it = rows.find(r => r.sku === sku);
      form.closest('.modal-bg').remove();
      if (it && await confirmBox(`Hapus ${it.sku}?`, 'Barang, tag QR, dan riwayat hitungnya akan dihapus permanen.', 'Hapus')) { await del(`/items/${it.id}`); toast('Barang dihapus'); load(); }
    }
    $('#all', root).addEventListener('change', e => { rows.forEach(r => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); load(); });
    $('#selClear', root).addEventListener('click', () => { sel.clear(); load(); });
    $('#printSel', root).addEventListener('click', async () => {
      const tags = await modal({ title: `Buat tag QR untuk ${sel.size} barang`,
        body: `<label class="field"><span>Jumlah tag per barang</span><input class="input" name="copies" type="number" min="1" max="50" value="1"></label>
          <p class="muted" style="font-size:14px">Tag baru akan dibuat. Satu barang boleh punya banyak tag (misal di beberapa rak).</p>`,
        submit: 'Buat & cetak', onSubmit: b => post('/tags', { items: [...sel].map(id => ({ item_id: id, copies: +b.copies || 1 })) }) });
      if (!tags) return;
      sessionStorage.setItem('opn-print', JSON.stringify(tags)); sel.clear(); go('/app/print');
    });
    $('#imp', root).addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      toast('Mengimpor…');
      try {
        const r = await api('/items/import', { method: 'POST', body: f, raw: true });
        toast(`✓ ${r.created} baru, ${r.updated} diperbarui${r.skipped ? `, ${r.skipped} baris dilewati` : ''}`);
        if (r.errors.length) await modal({ title: 'Baris yang dilewati', body: `<pre class="mono" style="white-space:pre-wrap;font-size:12px">${esc(r.errors.join('\n'))}</pre>`, submit: null });
        locs = await get('/locations'); load();
      } catch (err) { toast(err.message, true); }
    });
    return () => document.removeEventListener('click', delHandler);
  }
}
