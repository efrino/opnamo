import { esc } from '../ui.js';

const loadQr = () => window.qrcode ? Promise.resolve() : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.append(s);
});

function qrCanvas(text) {
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = 6, pad = 2, c = document.createElement('canvas');
  c.width = c.height = (n + pad * 2) * cell;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + pad) * cell, (r + pad) * cell, cell, cell);
  return c;
}

export async function render(root) {
  const tags = JSON.parse(sessionStorage.getItem('opn-print') || '[]');
  root.innerHTML = `
    <div class="page-head"><div><h1>Cetak tag QR</h1><p>${tags.length} tag siap dicetak</p></div>
      <div class="row"><div class="chips" id="fmt"><button class="active" data-f="a4">A4 · 3×8 stiker</button><button data-f="58">Thermal 58mm</button></div>
      <button class="btn primary" id="print" ${tags.length ? '' : 'disabled'}>🖨️ Cetak</button></div></div>
    ${tags.length ? '' : '<div class="empty"><b>Belum ada tag</b>Pilih barang di halaman <a class="grad" href="/app/items">Barang</a>, lalu klik "Cetak tag QR".</div>'}
    <p class="muted" style="font-size:14px;margin-bottom:12px">Tips: A4 cocok untuk kertas stiker label 3×8 (Tom & Jerry No. 121 / sejenisnya). Untuk printer thermal Bluetooth, pilih 58mm lalu cetak ke printer tersebut.</p>
    <div class="print-preview"><div class="print-sheet sheet-a4" id="sheet"></div></div>`;
  if (!tags.length) return;
  await loadQr();
  const sheet = root.querySelector('#sheet');
  for (const t of tags) {
    const el = document.createElement('div'); el.className = 'label';
    el.append(qrCanvas(`OPN:${t.code}`));
    el.insertAdjacentHTML('beforeend', `<div class="t"><b>${esc(t.name)}</b><span>${esc(t.sku)}${t.location ? ' · ' + esc(t.location) : ''}</span><code>${esc(t.code)}</code></div>`);
    sheet.append(el);
  }
  root.querySelector('#fmt').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    root.querySelectorAll('#fmt button').forEach(x => x.classList.toggle('active', x === b));
    sheet.className = `print-sheet sheet-${b.dataset.f}`;
  });
  root.querySelector('#print').addEventListener('click', () => window.print());
}
