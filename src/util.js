export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = msg => new HttpError(400, msg);

// Small validators: throw a 400 with an Indonesian message on bad input.
export function str(v, label, { min = 1, max = 200 } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw bad(`${label} wajib diisi${min > 1 ? ` (min. ${min} karakter)` : ''}.`);
  if (s.length > max) throw bad(`${label} maksimal ${max} karakter.`);
  return s;
}
export function optStr(v, label, opts) {
  return v === undefined || v === null || v === '' ? null : str(v, label, opts);
}
export function num(v, label, { min = 0, max = 1e12 } = {}) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${label} harus berupa angka.`);
  if (n < min || n > max) throw bad(`${label} harus antara ${min} dan ${max}.`);
  return n;
}
export function id(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${label} tidak valid.`);
  return n;
}
export const email = v => {
  const s = str(v, 'Email', { max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Format email tidak valid.');
  return s;
};
export const password = v => str(v, 'Password', { min: 8, max: 128 });
