// Utilidades compartidas: escape HTML, formato, validación y almacenamiento seguro.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = v => String(v ?? '').replace(/[&<>"'`]/g, c => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
/** Marca un fragmento como HTML de confianza (ya escapado). */
export const raw = s => new Raw(String(s));

/** Plantilla HTML que escapa todo lo interpolado salvo raw() o arrays de raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v === null || v === undefined || v === false) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── Almacenamiento local que nunca rompe la app ──
export const store = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

export function deviceId() {
  let id = store.get('cp_device');
  if (!id) { id = 'dev-' + uid().slice(0, 8); store.set('cp_device', id); }
  return id;
}

// ── Matrículas y documentos ──
export const normPlate = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const PLATE_LETTERS = 'BCDFGHJKLMNPRSTVWXYZ';
export function isValidPlate(p, foreign = false) {
  p = normPlate(p);
  if (foreign) return /^[A-Z0-9]{3,10}$/.test(p);
  const L = `[${PLATE_LETTERS}]`;
  return new RegExp(`^[0-9]{4}${L}{3}$`).test(p)
    || /^[A-Z]{1,2}[0-9]{4}[A-Z]{1,2}$/.test(p)
    || /^[A-Z]{1,2}[0-9]{6}$/.test(p)
    || new RegExp(`^[CER][0-9]{4}${L}{3}$`).test(p);
}

/** 1234BCD → 1234 BCD · SE1234AB → SE 1234 AB */
export function formatPlate(p) {
  p = normPlate(p);
  let m = /^([CER]?)([0-9]{4})([A-Z]{3})$/.exec(p);
  if (m) return (m[1] ? m[1] + ' ' : '') + m[2] + ' ' + m[3];
  m = /^([A-Z]{1,2})([0-9]{4,6})([A-Z]{0,2})$/.exec(p);
  if (m) return [m[1], m[2], m[3]].filter(Boolean).join(' ');
  return p;
}

export function isValidDni(v) {
  v = normPlate(v);
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  let m = /^([0-9]{8})([A-Z])$/.exec(v);
  if (m) return letters[Number(m[1]) % 23] === m[2];
  m = /^([XYZ])([0-9]{7})([A-Z])$/.exec(v);
  if (m) return letters[Number('XYZ'.indexOf(m[1]) + m[2]) % 23] === m[3];
  return false;
}

export function ageFrom(iso, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  return y < 1900 || age < 0 ? null : age;
}

// ── Fechas ──
const TZ = 'Europe/Madrid';
const fTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: TZ });
const fDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

export const fmtTime = ts => (ts ? fTime.format(new Date(Number(ts))) : '');
export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const same = fDayKey.format(d) === fDayKey.format(new Date());
  return same ? fTime.format(d) : `${fDate.format(d)}, ${fTime.format(d)}`;
}
export function fmtDuration(min) {
  if (min === null || min === undefined || min === '') return '';
  min = Number(min);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'ahora mismo';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return fmtWhen(ts);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Carga un script clásico una sola vez (para librerías UMD grandes, bajo demanda). */
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

/** CSV con escape correcto y protección contra fórmulas al abrirlo en Excel. */
export function toCsv(headers, rows) {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
