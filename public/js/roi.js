// Generic ROI calculator: <section data-roi="kind"> with range inputs named in CONFIG.
const rp = n => 'Rp' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n));
const num = n => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n);
const CONFIG = {
  balasin: {
    inputs: [['chats', 'Chat yang telat/tidak terbalas per hari', 2, 60, 1, 10, v => `${v} chat`], ['conv', 'Yang jadi beli bila dibalas cepat', 2, 30, 1, 10, v => `${v}%`],
      ['order', 'Rata-rata nilai pesanan', 15000, 500000, 5000, 50000, rp], ['margin', 'Margin keuntungan', 10, 70, 5, 30, v => `${v}%`]],
    calc: v => { const orders = v.chats * 30 * v.conv / 100, omzet = orders * v.order, profit = omzet * v.margin / 100, cost = 249000;
      return { big: rp(profit - cost), bigLabel: 'tambahan untung bersih per bulan', lines: [['Pesanan tambahan / bulan', `${num(orders)} pesanan`], ['Omzet tambahan / bulan', rp(omzet)], ['Untung kotor tambahan', rp(profit)], ['Biaya Balasin (paket Usaha)', '−' + rp(cost)], ['Balik modal setelah', `${Math.ceil(cost / Math.max(1, v.order * v.margin / 100))} pesanan`]], good: profit > cost }; } },
  opnamo: {
    inputs: [['people', 'Orang yang ikut stok opname', 1, 30, 1, 5, v => `${v} orang`], ['days', 'Lama opname cara manual', 1, 7, 0.5, 2, v => `${v} hari`],
      ['wage', 'Biaya per orang per hari', 100000, 600000, 25000, 250000, rp], ['freq', 'Opname per tahun', 1, 12, 1, 4, v => `${v}×`]],
    calc: v => { const manual = v.people * v.days * v.wage * v.freq, faster = manual * 0.5, cost = 199000 * 12;
      return { big: rp(faster - cost), bigLabel: 'perkiraan hemat per tahun', lines: [['Biaya opname manual / tahun', rp(manual)], ['Hemat bila waktu opname turun 50%', rp(faster)], ['Biaya Opnamo Starter / tahun', '−' + rp(cost)], ['Belum dihitung', 'selisih stok yang ketahuan lebih cepat']], good: faster > cost }; } },
  jasa: {
    inputs: [['hours', 'Jam planner menyusun & merevisi rencana per hari', 0.5, 8, 0.5, 3, v => `${v} jam`], ['rate', 'Biaya per jam karyawan', 30000, 200000, 5000, 60000, rp],
      ['incidents', 'Kejadian salah plan per bulan', 0, 6, 1, 1, v => `${v}×`], ['loss', 'Kerugian per kejadian (lembur, telat kirim, stok mati)', 1e6, 50e6, 1e6, 5e6, rp]],
    calc: v => { const labor = v.hours * 22 * 12 * v.rate, errors = v.incidents * 12 * v.loss, total = labor + errors, saved = labor * 0.7 + errors * 0.5;
      return { big: rp(total), bigLabel: 'biaya proses Excel Anda per tahun', lines: [['Waktu kerja planner / tahun', rp(labor)], ['Kerugian salah plan / tahun', rp(errors)], ['Potensi hemat (otomatisasi 70% waktu, kesalahan turun 50%)', rp(saved)], ['Paket Bisnis (sekali bayar)', 'Rp15–35jt']], good: saved > 15e6 }; } },
};
document.querySelectorAll('[data-roi]').forEach(sec => {
  const cfg = CONFIG[sec.dataset.roi]; if (!cfg) return;
  sec.innerHTML = `<div class="inputs">${cfg.inputs.map(([k, label, min, max, step, val]) => `<label><span class="row2"><span>${label}</span><output id="o-${k}"></output></span><input type="range" name="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`).join('')}
    <p class="note">Geser sesuai kondisi usaha Anda. Angka awal adalah contoh konservatif.</p></div>
    <div class="result" aria-live="polite"><div><div class="big" id="r-big"></div><div id="r-label" style="margin-top:6px;color:var(--muted)"></div></div><div id="r-lines"></div><p class="note">Perkiraan, bukan jaminan. Kami hitung ulang bersama Anda saat konsultasi.</p></div>`;
  const update = () => {
    const v = Object.fromEntries([...sec.querySelectorAll('input')].map(i => [i.name, +i.value]));
    cfg.inputs.forEach(([k, , , , , , f]) => sec.querySelector(`#o-${k}`).textContent = f(v[k]));
    const r = cfg.calc(v);
    sec.querySelector('#r-big').textContent = r.big;
    sec.querySelector('#r-big').style.color = r.good ? 'var(--ok)' : 'var(--text)';
    sec.querySelector('#r-label').textContent = r.bigLabel;
    sec.querySelector('#r-lines').innerHTML = r.lines.map(([a, b]) => `<div class="line"><span>${a}</span><b>${b}</b></div>`).join('');
  };
  sec.addEventListener('input', update); update();
});
