import { get } from './api.js';
import { $, esc } from './ui.js';
import { sync, queueAll, onSync } from './offline.js';

// path pattern -> lazy view module. Views export render(root, ctx) and may return a cleanup fn.
const ROUTES = [
  [/^\/app\/login$/, 'auth', { mode: 'login', public: true }],
  [/^\/app\/register$/, 'auth', { mode: 'register', public: true }],
  [/^\/app\/?$/, 'dashboard'],
  [/^\/app\/items$/, 'items'],
  [/^\/app\/print$/, 'print'],
  [/^\/app\/stocktakes$/, 'stocktakes'],
  [/^\/app\/stocktakes\/(\d+)$/, 'stocktake'],
  [/^\/app\/scan\/(\d+)$/, 'scan'],
  [/^\/app\/team$/, 'team'],
];
const NAV = [
  ['/app', '📊', 'Dashboard'], ['/app/stocktakes', '📋', 'Opname'], ['/app/items', '📦', 'Barang'], ['/app/team', '👥', 'Tim & Lokasi', true],
];

let me = null, cleanup = null;
export const currentUser = () => me;

export function go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}

async function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const path = location.pathname.replace(/\/$/, '') || '/app';
  const hit = ROUTES.find(([re]) => re.test(path)) || [null, 'dashboard'];
  const [re, view, opts = {}] = hit;
  const params = re ? path.match(re).slice(1) : [];

  if (!opts.public && !me) {
    try { me = await get('/auth/me'); } catch { return go('/app/login', true); }
  }
  const root = $('#root');
  if (opts.public) { root.innerHTML = ''; }
  else if (!$('.app', root)) root.innerHTML = shell();
  if (!opts.public) {
    document.querySelectorAll('.side a, .tabbar a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '/app' ? path === '/app' : path.startsWith(a.getAttribute('href'))));
  }
  const host = opts.public ? root : $('.main', root);
  host.innerHTML = '<p class="muted" style="padding:40px 0">Memuat…</p>';
  try {
    const mod = await import(`./views/${view}.js`);
    host.innerHTML = '';
    cleanup = (await mod.render(host, { params, opts, me, go })) || null;
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="empty"><b>Gagal memuat halaman</b>${esc(e.message)}<br><br><a class="btn" href="${esc(location.pathname)}">Coba lagi</a></div>`;
  }
  window.scrollTo(0, 0);
}

function shell() {
  const nav = NAV.filter(n => !n[3] || me.role === 'admin');
  const trial = me.plan === 'trial' ? Math.ceil((new Date(me.trial_ends) - Date.now()) / 86400e3) : null;
  return `<div class="app">
    <aside class="side">
      <a class="logo" href="/app"><i>✓</i>Opnamo</a>
      ${nav.map(([h, ic, t]) => `<a href="${h}"><span>${ic}</span>${t}</a>`).join('')}
      <div class="who"><b>${esc(me.name)}</b><div class="muted">${esc(me.company_name)}</div>
        <div class="muted" style="margin:4px 0 10px">${me.role === 'admin' ? 'Admin' : 'Penghitung'}${me.plan === 'demo' ? ' · Demo' : ''}</div>
        <button class="btn sm block" id="logout">Keluar</button></div>
    </aside>
    <main class="main" id="main"></main>
    <nav class="tabbar" style="--tabs:${nav.length + 1}">
      ${nav.map(([h, ic, t]) => `<a href="${h}"><span>${ic}</span>${t.split(' ')[0]}</a>`).join('')}
      <a href="#" id="logout-m"><span>🚪</span>Keluar</a>
    </nav>
  </div>${me.expired ? '<div class="banner" style="position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:45">Masa trial berakhir: data hanya bisa dibaca & diekspor.</div>' : ''}${trial !== null && trial <= 5 && trial > 0 ? `<div class="offline-pill" style="right:auto;left:50%;transform:translateX(-50%)">Trial tersisa ${trial} hari</div>` : ''}`;
}

document.addEventListener('click', async e => {
  if (e.target.closest('#logout, #logout-m')) {
    e.preventDefault();
    const pending = (await queueAll()).length;
    if (pending && !confirm(`${pending} hasil scan belum tersinkron dan akan hilang jika keluar. Tetap keluar?`)) return;
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'opnamo' } });
    me = null; location.href = '/app/login'; return;
  }
  const a = e.target.closest('a[href^="/app"]');
  if (a && !a.target && !e.metaKey && !e.ctrlKey && !a.hasAttribute('download')) { e.preventDefault(); go(a.getAttribute('href')); }
});
addEventListener('popstate', render);

// Connection indicator.
async function netPill() {
  let pill = $('#net');
  const pending = (await queueAll().catch(() => [])).length;
  const show = !navigator.onLine || pending;
  if (!show) return pill?.remove();
  if (!pill) { pill = document.createElement('div'); pill.id = 'net'; pill.className = 'offline-pill'; document.body.append(pill); }
  pill.textContent = navigator.onLine ? `⟳ ${pending} menunggu sinkron` : `⚡ Offline${pending ? ` · ${pending} tersimpan di HP` : ''}`;
}
addEventListener('online', netPill); addEventListener('offline', netPill); onSync(netPill);
setInterval(netPill, 5000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render(); sync(); netPill();
