import { get, post, patch, del } from '../api.js';
import { esc, fmtDate, modal, toast, confirmBox, $ } from '../ui.js';

export async function render(root, { me }) {
  const load = async () => {
    const [users, locs] = await Promise.all([get('/users'), get('/locations')]);
    const trial = me.plan === 'trial' ? Math.max(0, Math.ceil((new Date(me.trial_ends) - Date.now()) / 86400e3)) : null;
    root.innerHTML = `
      <div class="page-head"><div><h1>Tim & Lokasi</h1><p>${esc(me.company_name)}</p></div></div>
      ${trial !== null ? `<div class="banner">Paket Trial · sisa <b>${trial} hari</b>. Untuk berlangganan, hubungi <a href="mailto:efrinowep@gmail.com?subject=Langganan%20Opnamo" style="text-decoration:underline">efrinowep@gmail.com</a>.</div>` : ''}
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="font-size:18px">Anggota tim</h2><button class="btn primary sm" id="addU">＋ Anggota</button></div>
      <div class="tbl-wrap" style="margin-bottom:30px"><table><thead><tr><th>Nama</th><th class="hide-m">Email</th><th>Peran</th><th>Status</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr data-id="${u.id}"><td>${esc(u.name)}${u.id === me.id ? ' <span class="badge">Anda</span>' : ''}<div class="muted" style="font-size:12px">${fmtDate(u.created_at)}</div></td>
          <td class="hide-m">${esc(u.email)}</td><td><span class="badge ${u.role === 'admin' ? 'acc' : ''}">${u.role === 'admin' ? 'Admin' : 'Penghitung'}</span></td>
          <td><span class="badge ${u.active ? 'ok' : 'bad'}">${u.active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td class="num">${u.id === me.id ? '' : `<button class="btn sm" data-reset>Reset password</button> <button class="btn sm" data-toggle>${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="font-size:18px">Lokasi / gudang</h2><button class="btn primary sm" id="addL">＋ Lokasi</button></div>
      <div class="list">${locs.map(l => `<div class="entry" data-loc="${l.id}"><div><b>${esc(l.name)}</b> <span class="muted">· ${l.items} barang</span></div><button class="btn sm danger" data-dl>Hapus</button></div>`).join('') || '<div class="empty">Belum ada lokasi.</div>'}</div>`;

    $('#addU', root).onclick = async () => {
      if (await modal({ title: 'Tambah anggota', submit: 'Tambah', onSubmit: b => post('/users', b), body: `
        <label class="field"><span>Nama</span><input class="input" name="name" required maxlength="120"></label>
        <label class="field"><span>Email (untuk login)</span><input class="input" name="email" type="email" required></label>
        <label class="field"><span>Password awal (min. 8)</span><input class="input" name="password" required minlength="8"></label>
        <label class="field"><span>Peran</span><select class="input" name="role"><option value="counter">Penghitung: hanya scan</option><option value="admin">Admin: kelola semua</option></select></label>` })) { toast('Anggota ditambahkan. Bagikan email & password-nya.'); load(); }
    };
    $('#addL', root).onclick = async () => {
      if (await modal({ title: 'Lokasi baru', submit: 'Tambah', onSubmit: b => post('/locations', b), body: '<label class="field"><span>Nama lokasi</span><input class="input" name="name" required maxlength="80" placeholder="Rak A / Gudang 2"></label>' })) load();
    };
    root.querySelectorAll('tr[data-id]').forEach(tr => {
      const uid = tr.dataset.id, u = users.find(x => x.id === +uid);
      tr.querySelector('[data-toggle]')?.addEventListener('click', async () => { await patch(`/users/${uid}`, { active: !u.active }); toast('Tersimpan'); load(); });
      tr.querySelector('[data-reset]')?.addEventListener('click', async () => {
        if (await modal({ title: `Reset password ${u.name}`, submit: 'Simpan', onSubmit: b => patch(`/users/${uid}`, b), body: '<label class="field"><span>Password baru (min. 8)</span><input class="input" name="password" required minlength="8"></label>' })) toast('Password diganti');
      });
    });
    root.querySelectorAll('[data-loc]').forEach(el => el.querySelector('[data-dl]').addEventListener('click', async () => {
      if (await confirmBox('Hapus lokasi?', 'Barang di lokasi ini tidak ikut terhapus, hanya lokasinya dikosongkan.', 'Hapus')) { await del(`/locations/${el.dataset.loc}`); load(); }
    }));
  };
  await load();
}
