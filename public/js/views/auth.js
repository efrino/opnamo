import { post, get } from '../api.js';
import { esc, toast } from '../ui.js';

export async function render(root, { opts }) {
  const reg = opts.mode === 'register';
  root.innerHTML = `<div class="auth"><div class="box">
    <a class="logo" href="/"><i>✓</i>Opnamo</a>
    <h1>${reg ? 'Mulai trial gratis 14 hari' : 'Masuk ke akun Anda'}</h1>
    <p class="sub">${reg ? 'Tanpa kartu kredit. Siap dipakai dalam 5 menit.' : 'Stok opname cepat dengan scan QR dari HP.'}</p>
    <form class="card form" id="f">
      ${reg ? `<label class="field"><span>Nama usaha / perusahaan</span><input class="input" name="company" required maxlength="120" autocomplete="organization" placeholder="Toko Bangunan Sinar Jaya"></label>
      <label class="field"><span>Nama Anda</span><input class="input" name="name" required maxlength="120" autocomplete="name"></label>` : ''}
      <label class="field"><span>Email</span><input class="input" name="email" type="email" required autocomplete="email" inputmode="email"></label>
      <label class="field"><span>Password${reg ? ' (min. 8 karakter)' : ''}</span><input class="input" name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary block">${reg ? 'Buat akun' : 'Masuk'}</button>
      ${reg ? '' : '<button type="button" class="btn block" id="demo">👀 Coba akun demo</button>'}
    </form>
    <p class="alt">${reg ? 'Sudah punya akun? <a href="/app/login">Masuk</a>' : 'Belum punya akun? <a href="/app/register">Daftar gratis</a>'}</p>
  </div></div>`;

  const f = root.querySelector('#f');
  const submit = async body => {
    const btn = f.querySelector('.btn.primary'); btn.disabled = true;
    try { await post(`/auth/${reg ? 'register' : 'login'}`, body); location.href = '/app'; }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  f.addEventListener('submit', e => { e.preventDefault(); submit(Object.fromEntries(new FormData(f))); });
  root.querySelector('#demo')?.addEventListener('click', async () => submit(await get('/demo')));
  if (new URLSearchParams(location.search).has('demo')) root.querySelector('#demo')?.click();
}
