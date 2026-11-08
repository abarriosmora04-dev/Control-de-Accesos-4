// Modo sin conexión para el escáner.
// - Guarda una copia local de los pases (solo datos mínimos, nunca DNI ni email).
// - Si no hay red, valida contra esa copia, apunta el movimiento y lo envía al volver la conexión.
// - El servidor aplica los movimientos en orden y no los duplica (clientId).
import { api } from './api.js';
import { store, normPlate } from './util.js';
import { parseQr } from './qr.js';

const SNAP = 'cp_snapshot';
const QUEUE = 'cp_queue';
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const offline = {
  snapshot() { return store.get(SNAP); },

  async refresh() {
    const data = await api('snapshot', {}, { timeout: 20000 });
    // Reaplica los movimientos pendientes sobre la copia recién descargada
    const snap = { at: Date.now(), users: data.users, config: data.config };
    this.queue().forEach(item => applyLocal(snap, item));
    store.set(SNAP, snap);
    emit('cp:snapshot', snap);
    return snap;
  },

  updateUser(user) {
    const snap = this.snapshot();
    if (!snap || !user) return;
    const i = snap.users.findIndex(u => u.id === user.id);
    if (i >= 0) snap.users[i] = { ...snap.users[i], ...user };
    else snap.users.push(user);
    store.set(SNAP, snap);
  },

  queue() { return store.get(QUEUE, []); },
  pending() { return this.queue().length; },

  /** Evalúa un escaneo con la copia local. Solo se encolan los que resultan válidos. */
  evaluate(item) {
    const snap = this.snapshot();
    if (!snap) return { result: 'no_snapshot', offline: true };
    const res = applyLocal(snap, item);
    if (res.result === 'ok') {
      store.set(SNAP, snap);
      const q = this.queue();
      q.push({ ...item, localResult: 'ok' });
      store.set(QUEUE, q);
      emit('cp:queue', q.length);
    }
    return { ...res, offline: true };
  },

  _syncing: null,
  sync() {
    if (this._syncing) return this._syncing;
    const q = this.queue();
    if (!q.length) return Promise.resolve({ sent: 0, conflicts: [] });
    this._syncing = (async () => {
      try {
        const items = q.slice(0, 100).map(({ localResult, ...rest }) => rest);
        const { results } = await api('scanBatch', { items }, { timeout: 30000 });
        const done = new Set(results.map(r => r.clientId));
        const conflicts = results.filter(r => r.result !== 'ok');
        results.forEach(r => r.user && this.updateUser(r.user));
        const left = this.queue().filter(x => !done.has(x.clientId));
        store.set(QUEUE, left);
        emit('cp:queue', left.length);
        emit('cp:sync', { sent: results.length, conflicts });
        return { sent: results.length, conflicts };
      } finally {
        this._syncing = null;
      }
    })();
    return this._syncing;
  },
};

function findUser(users, item) {
  if (item.qr) {
    const p = parseQr(item.qr);
    if (!p) return null;
    if (p.token) return users.find(u => u.token === p.token) || null;
    if (p.plate) return users.find(u => normPlate(u.plate) === p.plate) || null;
    return null;
  }
  if (item.plate) return users.find(u => normPlate(u.plate) === normPlate(item.plate)) || null;
  return null;
}

/** Misma lógica que el servidor (processScan_), sobre la copia local. Modifica snap. */
function applyLocal(snap, item) {
  const u = findUser(snap.users, item);
  const base = { mode: item.mode, zona: item.zona, ts: item.ts };
  if (!u) return { ...base, result: 'not_found' };
  if (item.mode === 'entry') {
    if (u.status === 'in') return { ...base, result: 'already_in', user: { ...u }, entryTs: u.entryTs };
    if (u.zona && u.zona !== item.zona) return { ...base, result: 'wrong_zone', user: { ...u } };
    u.status = 'in'; u.entryTs = item.ts;
    return { ...base, result: 'ok', user: { ...u }, entryTs: item.ts };
  }
  if (u.status !== 'in') return { ...base, result: 'not_in', user: { ...u } };
  if (u.zona && u.zona !== item.zona) return { ...base, result: 'wrong_zone', user: { ...u } };
  const entryTs = u.entryTs;
  const durationMin = entryTs ? Math.max(0, Math.round((item.ts - entryTs) / 60000)) : null;
  u.status = 'out'; u.entryTs = null;
  return { ...base, result: 'ok', user: { ...u }, entryTs, durationMin };
}
