import { get } from '../api.js';
import { esc, fmtNum, fmtDate, toast, $ } from '../ui.js';
import { enqueue, saveCatalog, getCatalog, queueAll, failedAll, clearFailed, onSync, sync } from '../offline.js';

const loadJsQR = () => window.jsQR ? Promise.resolve() : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = '/vendor/jsQR.js'; s.onload = res; s.onerror = rej; document.head.append(s);
});

let audio;
function beep(ok = true) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1250 : 300; g.gain.value = 0.08;
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch {}
  navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
}

export async function render(root, { params: [sid] }) {
  // Catalog: fresh from the server when online, otherwise the copy saved on this phone.
  let cat;
  try { cat = await get(`/stocktakes/${sid}/catalog`); await saveCatalog(+sid, cat); }
  catch (e) { cat = await getCatalog(+sid); if (!cat) throw new Error('Data opname belum tersimpan di HP ini. Buka halaman ini sekali saat online.'); }
  if (cat.stocktake.status !== 'open') {
    root.innerHTML = `<div class="empty"><b>Sesi sudah ditutup</b>Hasil tidak bisa ditambah lagi.<br><br><a class="btn" href="/app/stocktakes/${sid}">Lihat laporan</a></div>`;
    return;
  }
  const byCode = new Map(), bySku = new Map();
  const index = it => { bySku.set(it.sku.toLowerCase(), it); it.tags.forEach(c => byCode.set(c, it)); };
  cat.items.forEach(index);
  const session = []; // entries saved from this screen

  root.innerHTML = `
    <div class="scan">
      <div class="row" style="justify-content:space-between"><a class="muted" href="/app/stocktakes/${sid}" style="font-size:14px">← ${esc(cat.stocktake.name)}</a>
        <span class="badge acc">${esc(cat.stocktake.location || 'Semua lokasi')} · ${cat.items.length} barang</span></div>
      <div class="viewfinder" id="vf"><video id="v" playsinline muted></video><div class="frame"></div><div class="msg" id="vmsg">Arahkan kamera ke tag QR</div>
        <div class="off hidden" id="voff"><div><div style="font-size:40px">📷</div><p>Kamera belum aktif.</p><br><button class="btn primary" id="startCam">Aktifkan kamera</button></div></div></div>
      <div class="row"><button class="btn sm" id="torch" hidden>🔦 Senter</button><span class="grow"></span><span class="muted" style="font-size:13px">atau ketik manual ↓</span></div>
      <form class="row" id="manual"><input class="input grow" id="code" placeholder="Kode tag / SKU / nama barang" autocomplete="off" list="dl"><button class="btn">Cari</button></form>
      <datalist id="dl">${cat.items.slice(0, 3000).map(i => `<option value="${esc(i.sku)}">${esc(i.name)}</option>`).join('')}</datalist>

      <form class="item-card hidden" id="card">
        <div class="row" style="justify-content:space-between;align-items:start"><div style="min-width:0"><h3 id="cName"></h3><div class="muted mono" id="cMeta" style="font-size:13px"></div></div>
          <button type="button" class="btn sm" id="cancel" aria-label="Batal">✕</button></div>
        <div class="muted" id="cPrev" style="font-size:13px;margin-top:6px"></div>
        <div class="qty"><button type="button" data-d="-1" aria-label="Kurangi">−</button><input class="input" id="qty" inputmode="decimal" autocomplete="off" aria-label="Qty fisik"><button type="button" data-d="1" aria-label="Tambah">+</button></div>
        <input class="input" id="note" placeholder="Catatan (opsional): rusak, kedaluwarsa…" maxlength="200" style="margin-top:8px">
        <button class="btn primary block" style="margin-top:10px;min-height:54px;font-size:17px">✓ Simpan hitungan</button>
      </form>

      <div class="sync-bar"><span id="syncTxt"></span><button class="btn sm" id="syncNow">Sinkron</button></div>
      <div class="list" id="failed"></div>
      <div class="list" id="mine"></div>
    </div>`;

  const video = $('#v', root), vf = $('#vf', root), card = $('#card', root), qty = $('#qty', root);
  let stream, timer, current = null, detector, paused = false, stopped = false;

  // --- camera
  async function startCamera() {
    $('#voff', root).classList.add('hidden');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      video.srcObject = stream; await video.play();
      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities?.().torch) { const t = $('#torch', root); t.hidden = false; let on = false; t.onclick = () => track.applyConstraints({ advanced: [{ torch: (on = !on) }] }); }
      // Native detector (Android Chrome) also reads product barcodes; desktop/iOS often expose it without QR support.
      const fmts = 'BarcodeDetector' in window ? await BarcodeDetector.getSupportedFormats().catch(() => []) : [];
      if (fmts.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'].filter(f => fmts.includes(f)) });
      else await loadJsQR();
      loop();
    } catch (e) {
      $('#voff', root).classList.remove('hidden');
      $('#voff p', root).textContent = e.name === 'NotAllowedError' ? 'Izin kamera ditolak. Aktifkan di pengaturan browser, atau ketik kode manual.' : 'Kamera tidak tersedia di perangkat ini. Gunakan input manual.';
    }
  }
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  async function loop() {
    if (stopped) return;
    if (!paused && video.readyState >= 2) {
      let val = null;
      try {
        if (detector) { const r = await detector.detect(video); val = r[0]?.rawValue; }
        else {
          const s = Math.min(video.videoWidth, video.videoHeight), side = 640;
          canvas.width = canvas.height = side;
          ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, side, side);
          val = window.jsQR(ctx.getImageData(0, 0, side, side).data, side, side, { inversionAttempts: 'dontInvert' })?.data;
        }
      } catch {}
      if (val) await found(val);
    }
    timer = setTimeout(loop, 120);
  }

  // --- resolve a scanned/typed value
  async function resolve(raw) {
    const v = String(raw).trim(), code = v.replace(/^OPN:/i, '').toUpperCase();
    let it = byCode.get(code) || bySku.get(v.toLowerCase());
    if (!it && v.length >= 3) { // name search for manual typing
      const m = cat.items.filter(i => i.name.toLowerCase().includes(v.toLowerCase()));
      if (m.length === 1) it = m[0];
    }
    if (!it && navigator.onLine) { // tag printed after the catalog was downloaded
      try { const h = await get(`/tags/lookup/${encodeURIComponent(v)}`); it = cat.items.find(i => i.id === h.item_id); if (it && h.code) { it.tags.push(h.code); index(it); } } catch {}
    }
    return it ? { it, code: byCode.has(code) ? `OPN:${code}` : it.sku } : null;
  }

  async function found(val) {
    paused = true;
    const hit = await resolve(val);
    if (!hit) { beep(false); toast(`Kode "${String(val).slice(0, 30)}" tidak ada di opname ini`, true); setTimeout(() => (paused = false), 1500); return; }
    beep(true); vf.classList.add('hit'); setTimeout(() => vf.classList.remove('hit'), 400);
    open(hit);
  }

  function open({ it, code }) {
    current = { it, code };
    $('#cName', root).textContent = it.name;
    $('#cMeta', root).textContent = `${it.sku} · ${it.location || '–'} · sistem ${fmtNum(it.system_qty)} ${it.unit}`;
    const prev = session.filter(e => e.item_id === it.id);
    $('#cPrev', root).textContent = prev.length ? `Sudah Anda hitung ${prev.length}× di sesi ini (total ${fmtNum(prev.reduce((a, e) => a + e.qty, 0))}). Hitungan baru akan DITAMBAHKAN.` : '';
    qty.value = ''; $('#note', root).value = '';
    card.classList.remove('hidden'); card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => qty.focus(), 250);
  }
  function closeCard() { card.classList.add('hidden'); current = null; paused = false; }

  card.addEventListener('click', e => {
    const d = e.target.closest('[data-d]'); if (!d) return;
    qty.value = Math.max(0, (parseFloat(String(qty.value).replace(',', '.')) || 0) + +d.dataset.d);
  });
  $('#cancel', root).addEventListener('click', closeCard);
  card.addEventListener('submit', async e => {
    e.preventDefault();
    const n = parseFloat(String(qty.value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) { toast('Isi qty fisik (angka ≥ 0)', true); return qty.focus(); }
    let entry;
    try { entry = await enqueue({ stocktake_id: +sid, code: current.code, qty: n, note: $('#note', root).value.trim() || undefined, label: current.it.name }); }
    catch (err) { console.error(err); return toast('Gagal menyimpan di HP ini. Coba muat ulang halaman.', true); }
    session.unshift({ ...entry, item_id: current.it.id, sku: current.it.sku, unit: current.it.unit });
    toast(`✓ ${current.it.name}: ${fmtNum(n)} ${current.it.unit}`);
    closeCard(); renderMine();
  });
  $('#manual', root).addEventListener('submit', async e => {
    e.preventDefault(); const v = $('#code', root).value; if (!v.trim()) return;
    const hit = await resolve(v);
    if (!hit) return toast('Tidak ditemukan. Coba SKU/kode lain.', true);
    $('#code', root).value = ''; paused = true; open(hit);
  });
  $('#startCam', root).addEventListener('click', startCamera);
  $('#syncNow', root).addEventListener('click', () => sync());

  // --- my entries + sync status
  async function renderMine() {
    const pending = new Set((await queueAll()).map(e => e.client_id));
    const failed = (await failedAll()).filter(e => e.stocktake_id === +sid);
    $('#syncTxt', root).textContent = !navigator.onLine ? `⚡ Offline · ${pending.size} tersimpan di HP` : pending.size ? `⟳ ${pending.size} menunggu sinkron` : '✓ Semua tersinkron';
    $('#failed', root).innerHTML = failed.length ? `<div class="banner" style="margin:0">${failed.length} scan ditolak server: ${esc(failed[0].error)} <button class="btn sm" id="clrF" style="margin-left:8px">Hapus</button></div>` : '';
    $('#clrF', root)?.addEventListener('click', async () => { await clearFailed(); renderMine(); });
    $('#mine', root).innerHTML = session.length ? '<b style="font-size:15px">Hitungan Anda (sesi ini)</b>' + session.slice(0, 50).map(e => `
      <div class="entry ${pending.has(e.client_id) ? 'pending' : ''}"><div><b>${esc(e.label)}</b> <span class="muted mono">${esc(e.sku)}</span>
        <div class="muted" style="font-size:12px">${fmtDate(e.counted_at)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
        <div style="text-align:right"><b>${fmtNum(e.qty)} ${esc(e.unit)}</b><div style="font-size:11px" class="${pending.has(e.client_id) ? 'warn' : 'ok'}">${pending.has(e.client_id) ? '⟳ belum sinkron' : '✓ tersinkron'}</div></div></div>`).join('') : '';
  }
  const off = onSync(renderMine);
  const net = () => renderMine(); addEventListener('online', net); addEventListener('offline', net);
  renderMine();
  if (navigator.mediaDevices?.getUserMedia) startCamera(); else $('#voff', root).classList.remove('hidden');

  return () => {
    stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop());
    off(); removeEventListener('online', net); removeEventListener('offline', net);
  };
}
