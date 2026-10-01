export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
export const fmtNum = n => (n === null || n === undefined ? '–' : nf.format(n));
export const fmtRp = n => (n === null || n === undefined ? '–' : (n < 0 ? '−' : '') + 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(n)));
export const fmtDate = d => new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const signed = n => (n > 0 ? '+' : '') + fmtNum(n);

let tt;
export function toast(msg, err = false) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast'), 3200);
}

// Modal with a form. onSubmit(formData) may throw to keep it open.
export function modal({ title, body, submit = 'Simpan', danger = false, onSubmit }) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="form">${body}</div>
      <div class="actions"><button type="button" class="btn" data-x>Batal</button>${submit ? `<button class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button>` : ''}</div></form>`;
    const close = v => { bg.remove(); resolve(v); };
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-x]')) close(null); });
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    bg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try { close(await (onSubmit ? onSubmit(Object.fromEntries(new FormData(e.target)), e.target) : true) ?? true); }
      catch (err) { toast(err.message, true); if (btn) btn.disabled = false; }
    });
    document.body.append(bg);
    (bg.querySelector('input,select,textarea') || bg.querySelector('button')).focus();
  });
}
export const confirmBox = (title, text, submit = 'Ya, lanjutkan', danger = true) => modal({ title, body: `<p class="muted">${text}</p>`, submit, danger });

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
