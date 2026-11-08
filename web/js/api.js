// Cliente del backend de Apps Script. Todas las llamadas van por POST con cuerpo text/plain
// (evita la petición previa CORS y que los datos viajen en la URL).
import { API_URL } from './config.js';
import { store } from './util.js';

export class ApiError extends Error {
  constructor(code, message, extra, network = false) {
    super(message);
    this.code = code; this.extra = extra; this.network = network;
  }
}

const SESSION_KEY = 'cp_session';

export const session = {
  get() {
    const s = store.get(SESSION_KEY);
    if (!s || !s.session || s.expires < Date.now()) return null;
    return s;
  },
  set(s) { store.set(SESSION_KEY, s); window.dispatchEvent(new CustomEvent('cp:session')); },
  clear() { store.del(SESSION_KEY); window.dispatchEvent(new CustomEvent('cp:session')); },
  role() { return this.get()?.role || null; },
};

export async function api(action, payload = {}, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const s = session.get();
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...(s ? { session: s.session } : {}), ...payload }),
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } catch (e) {
    throw new ApiError('network', 'Sin conexión con el servidor', null, true);
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await res.json(); } catch {
    throw new ApiError('bad_response', `El servidor respondió con un error (${res.status})`, null, res.status >= 500);
  }
  if (!body.ok) {
    const err = body.error || {};
    if (err.code === 'auth') session.clear();
    throw new ApiError(err.code || 'error', err.message || 'Error desconocido', err.extra);
  }
  return body.data;
}
