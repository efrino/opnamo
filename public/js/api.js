// Fetch wrapper: JSON in/out, CSRF header, friendly errors, 401 -> login.
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, raw } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { 'x-requested-with': 'opnamo', ...(body && !raw ? { 'content-type': 'application/json' } : {}) },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
  } catch { throw new ApiError(0, 'Tidak ada koneksi internet.'); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/auth/')) { location.href = '/app/login'; throw new ApiError(401, 'Sesi berakhir.'); }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Gagal (${res.status}).`);
  return data;
}
export const get = p => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = p => api(p, { method: 'DELETE' });
