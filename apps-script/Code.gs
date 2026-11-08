/**
 * ControlPark · Control de Accesos — Backend v3 (Google Apps Script)
 *
 * Qué cambia respecto a la versión anterior:
 *  - Los datos personales ya no son públicos: solo el personal autenticado puede leerlos.
 *  - Inicio de sesión real con dos roles (operador = escanear, admin = todo), con sesión firmada.
 *  - Cada pase lleva un token aleatorio: el QR ya no se puede falsificar conociendo la matrícula.
 *  - Entradas y salidas se validan en el servidor con bloqueo (LockService): sin dobles entradas
 *    aunque haya varios escáneres a la vez.
 *  - Recepción de lotes de escaneos hechos sin conexión, con idempotencia.
 *  - Protección contra inyección de fórmulas en Sheets, límites de peticiones y bloqueo por
 *    intentos fallidos de contraseña.
 *
 * Instalación: ver apps-script/README.md
 */

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DEL EVENTO — edita aquí
// ════════════════════════════════════════════════════════════════
const CONFIG = {
  eventName: 'ControlPark',
  // URL pública de la app (se usa en los emails con el enlace al pase)
  appUrl: 'https://abarriosmora04-dev.github.io/Control-de-Accesos-4/',
  // capacity: plazas de la zona (0 = sin límite / no mostrar aforo)
  zones: [
    { id: 'polideportivo', name: 'Polideportivo', capacity: 0 },
    { id: 'feria', name: 'Av. de la Feria', capacity: 0 },
  ],
  minAge: 18,               // edad mínima para registrarse (0 = sin control)
  requireBirthDate: true,
  requireDni: true,         // necesario para impedir pases duplicados y para recuperar el pase
  requireEmail: true,       // necesario para recuperar el pase
  requirePhone: false,
  enforceCapacity: false,   // true = denegar entradas cuando la zona está llena
  allowLegacyQr: true,      // aceptar los QR antiguos (solo matrícula). Desactívalo cuando todos tengan el pase nuevo
  sendEmailOnRegister: false, // true = enviar email con el enlace al pase (usa la cuota de MailApp)
  sessionHours: 14,
  timezone: 'Europe/Madrid',
  privacyContact: 'info@controlpark.es',
};

const VERSION = 3;
const SHEET_USERS = 'Usuarios';
const SHEET_LOGS = 'Movimientos';
const USER_COLS = ['id', 'token', 'plate', 'nombre', 'apellidos', 'nacimiento', 'dni', 'email', 'telefono',
  'marca', 'modelo', 'zona', 'status', 'entryTs', 'lastExitTs', 'registeredAt', 'consentAt', 'updatedAt'];
const LOG_COLS = ['ts', 'fecha', 'action', 'result', 'plate', 'userId', 'nombre', 'zona', 'scanZona',
  'durationMin', 'role', 'device', 'offline', 'clientId', 'detail'];

// ════════════════════════════════════════════════════════════════
//  ENTRADA HTTP
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'config') return json_({ ok: true, data: publicConfig_() });
  return json_({ ok: true, data: { service: 'ControlPark', version: VERSION } });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: { code: 'bad_request', message: 'Petición no válida' } });
  }
  try {
    const handler = ACTIONS[body.action];
    if (!handler) throw fail_('unknown_action', 'Acción desconocida');
    return json_({ ok: true, data: handler(body) });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: { code: err.code, message: err.message, extra: err.extra } });
    console.error(err && err.stack || err);
    return json_({ ok: false, error: { code: 'server_error', message: 'Error interno del servidor' } });
  }
}

const ACTIONS = {
  // públicas
  config: () => publicConfig_(),
  register: actionRegister_,
  pass: actionPass_,
  recover: actionRecover_,
  login: actionLogin_,
  // personal (operador o admin)
  session: (p) => auth_(p, ['operator', 'admin']),
  snapshot: actionSnapshot_,
  scan: actionScan_,
  scanBatch: actionScanBatch_,
  // admin
  dashboard: actionDashboard_,
  forceExit: actionForceExit_,
  revoke: actionRevoke_,
  deleteUser: actionDeleteUser_,
  allLogs: actionAllLogs_,
};

// ════════════════════════════════════════════════════════════════
//  ACCIONES PÚBLICAS
// ════════════════════════════════════════════════════════════════
function publicConfig_() {
  return {
    version: VERSION,
    eventName: CONFIG.eventName,
    zones: CONFIG.zones.map(z => ({ id: z.id, name: z.name, capacity: z.capacity || 0 })),
    minAge: CONFIG.minAge,
    requireBirthDate: CONFIG.requireBirthDate,
    requireDni: CONFIG.requireDni,
    requireEmail: CONFIG.requireEmail,
    requirePhone: CONFIG.requirePhone,
    privacyContact: CONFIG.privacyContact,
  };
}

function actionRegister_(p) {
  if (p.website) throw fail_('invalid', 'Registro no válido'); // honeypot anti-bots
  rateLimit_('reg', 40, 60, 'Demasiados registros en este momento. Inténtalo en un minuto.');

  const u = validateRegistration_(p.user || {});
  const lock = lock_();
  try {
    const sh = usersSheet_();
    const users = readAll_(sh, USER_COLS);
    if (u.dni && users.some(x => norm_(x.dni) === u.dni)) {
      throw fail_('dni_exists', 'Este DNI/NIE ya tiene un pase registrado. Puedes recuperarlo con tu DNI y tu email.');
    }
    if (users.some(x => norm_(x.plate) === u.plate)) {
      throw fail_('plate_exists', 'Esta matrícula ya tiene un pase registrado. Si es tuya, recupéralo con tu DNI y tu email.');
    }
    const now = Date.now();
    Object.assign(u, {
      id: Utilities.getUuid(), token: newToken_(), status: 'out', entryTs: '', lastExitTs: '',
      registeredAt: now, consentAt: now, updatedAt: now,
    });
    appendObj_(sh, USER_COLS, u);
    if (CONFIG.sendEmailOnRegister && u.email) sendPassEmail_(u);
    return publicPass_(u);
  } finally {
    lock.releaseLock();
  }
}

function actionPass_(p) {
  const token = String(p.token || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) throw fail_('pass_not_found', 'Pase no encontrado');
  const u = readAll_(usersSheet_(), USER_COLS).find(x => String(x.token) === token);
  if (!u) throw fail_('pass_not_found', 'Este pase ya no es válido. Puede que el administrador lo haya renovado.');
  return publicPass_(u);
}

function actionRecover_(p) {
  const dni = norm_(p.dni);
  const email = String(p.email || '').trim().toLowerCase();
  if (!dni || !email) throw fail_('invalid', 'Introduce tu DNI/NIE y tu email');
  rateLimit_('rec_' + dni, 5, 3600, 'Demasiados intentos. Vuelve a probar dentro de una hora.');
  rateLimit_('rec', 60, 60, 'Demasiadas peticiones. Inténtalo en un minuto.');
  const u = readAll_(usersSheet_(), USER_COLS)
    .find(x => norm_(x.dni) === dni && String(x.email).trim().toLowerCase() === email);
  if (!u) throw fail_('not_found', 'No hay ningún pase con ese DNI/NIE y ese email.');
  return publicPass_(u);
}

function actionLogin_(p) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fail') || 0);
  if (fails >= 20) throw fail_('locked', 'Demasiados intentos fallidos. Espera 10 minutos.');
  const pw = String(p.password || '');
  const props = PropertiesService.getScriptProperties();
  let role = null;
  if (pw && safeEqual_(pw, props.getProperty('ADMIN_PASSWORD') || '')) role = 'admin';
  else if (pw && safeEqual_(pw, props.getProperty('OPERATOR_PASSWORD') || '')) role = 'operator';
  if (!role) {
    cache.put('login_fail', String(fails + 1), 600);
    throw fail_('bad_password', 'Contraseña incorrecta');
  }
  const expires = Date.now() + CONFIG.sessionHours * 3600 * 1000;
  return { session: signSession_(role, expires), role: role, expires: expires };
}

// ════════════════════════════════════════════════════════════════
//  ACCIONES DEL PERSONAL
// ════════════════════════════════════════════════════════════════
function actionSnapshot_(p) {
  auth_(p, ['operator', 'admin']);
  const users = readAll_(usersSheet_(), USER_COLS).map(staffUser_);
  return { serverTime: Date.now(), users: users, config: publicConfig_() };
}

function actionScan_(p) {
  const a = auth_(p, ['operator', 'admin']);
  const lock = lock_();
  try {
    const ctx = scanContext_();
    const res = processScan_(ctx, p, a);
    flushLogs_(ctx);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function actionScanBatch_(p) {
  const a = auth_(p, ['operator', 'admin']);
  const items = Array.isArray(p.items) ? p.items.slice(0, 200) : [];
  items.sort((x, y) => Number(x.ts || 0) - Number(y.ts || 0));
  const cache = CacheService.getScriptCache();
  const lock = lock_();
  try {
    const ctx = scanContext_();
    const results = items.map(item => {
      const cid = String(item.clientId || '').slice(0, 64);
      if (cid) {
        const done = cache.get('cid_' + cid);
        if (done) return JSON.parse(done);
      }
      const r = processScan_(ctx, Object.assign({}, item, { offline: true }), a);
      r.clientId = cid;
      if (cid) cache.put('cid_' + cid, JSON.stringify(r), 21600);
      return r;
    });
    flushLogs_(ctx);
    return { results: results };
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════════════════════
//  ACCIONES DE ADMINISTRACIÓN
// ════════════════════════════════════════════════════════════════
function actionDashboard_(p) {
  auth_(p, ['admin']);
  const users = readAll_(usersSheet_(), USER_COLS).map(adminUser_);
  const logs = readAll_(logsSheet_(), LOG_COLS);
  const now = Date.now();
  const startToday = startOfDay_(now);
  const hourly = [];
  for (let i = 11; i >= 0; i--) {
    const from = Math.floor(now / 3600000) * 3600000 - i * 3600000;
    hourly.push({ from: from, entries: 0, exits: 0 });
  }
  let entriesToday = 0, exitsToday = 0;
  logs.forEach(l => {
    const ts = Number(l.ts);
    const isEntry = l.action === 'entry' && l.result === 'ok';
    const isExit = (l.action === 'exit' || l.action === 'manual_exit') && l.result === 'ok';
    if (ts >= startToday) { if (isEntry) entriesToday++; if (isExit) exitsToday++; }
    const h = hourly.find(b => ts >= b.from && ts < b.from + 3600000);
    if (h) { if (isEntry) h.entries++; if (isExit) h.exits++; }
  });
  const recent = logs.slice(-300).reverse().map(logOut_);
  return {
    serverTime: now,
    config: publicConfig_(),
    users: users,
    logs: recent,
    totalLogs: logs.length,
    stats: { entriesToday: entriesToday, exitsToday: exitsToday, hourly: hourly },
  };
}

function actionForceExit_(p) {
  const a = auth_(p, ['admin']);
  const lock = lock_();
  try {
    const ctx = scanContext_();
    const u = ctx.users.find(x => x.id === p.userId);
    if (!u) throw fail_('not_found', 'Usuario no encontrado');
    if (u.status !== 'in') throw fail_('not_in', 'Este vehículo no está dentro');
    const now = Date.now();
    const duration = u.entryTs ? Math.round((now - Number(u.entryTs)) / 60000) : '';
    const zona = u.zona;
    setUser_(ctx, u, { status: 'out', entryTs: '', lastExitTs: now, updatedAt: now });
    queueLog_(ctx, { ts: now, action: 'manual_exit', result: 'ok', user: u, scanZona: zona, durationMin: duration, role: a.role, detail: 'Salida manual desde el panel' });
    flushLogs_(ctx);
    return adminUser_(u);
  } finally {
    lock.releaseLock();
  }
}

function actionRevoke_(p) {
  const a = auth_(p, ['admin']);
  const lock = lock_();
  try {
    const ctx = scanContext_();
    const u = ctx.users.find(x => x.id === p.userId);
    if (!u) throw fail_('not_found', 'Usuario no encontrado');
    const now = Date.now();
    setUser_(ctx, u, { token: newToken_(), updatedAt: now });
    queueLog_(ctx, { ts: now, action: 'revoke', result: 'ok', user: u, role: a.role, detail: 'QR renovado; el anterior deja de funcionar' });
    flushLogs_(ctx);
    return adminUser_(u);
  } finally {
    lock.releaseLock();
  }
}

function actionDeleteUser_(p) {
  const a = auth_(p, ['admin']);
  const lock = lock_();
  try {
    const sh = usersSheet_();
    const users = readAll_(sh, USER_COLS);
    const u = users.find(x => x.id === p.userId);
    if (!u) throw fail_('not_found', 'Usuario no encontrado');
    sh.deleteRow(u._row);
    const now = Date.now();
    appendObj_(logsSheet_(), LOG_COLS, logRow_({ ts: now, action: 'delete', result: 'ok', user: { plate: u.plate, id: u.id, nombre: '', apellidos: '', zona: u.zona }, role: a.role, detail: 'Datos personales eliminados' }));
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function actionAllLogs_(p) {
  auth_(p, ['admin']);
  return { logs: readAll_(logsSheet_(), LOG_COLS).reverse().map(logOut_) };
}

// ════════════════════════════════════════════════════════════════
//  LÓGICA DE ESCANEO
// ════════════════════════════════════════════════════════════════
function scanContext_() {
  const sh = usersSheet_();
  return { sheet: sh, users: readAll_(sh, USER_COLS), logs: [] };
}

/**
 * Procesa un escaneo. Devuelve siempre un objeto con `result`:
 * ok | not_found | already_in | not_in | wrong_zone | full | bad_zone | bad_mode
 */
function processScan_(ctx, item, a) {
  const now = Date.now();
  let ts = Number(item.ts) || now;
  if (ts > now + 5 * 60000 || ts < now - 72 * 3600000) ts = now;
  const mode = item.mode === 'exit' ? 'exit' : (item.mode === 'entry' ? 'entry' : null);
  const zone = CONFIG.zones.find(z => z.id === item.zona);
  const base = { mode: mode, zona: item.zona, ts: ts };
  if (!mode) return Object.assign(base, { result: 'bad_mode' });
  if (!zone) return Object.assign(base, { result: 'bad_zone' });

  const u = findUserForScan_(ctx.users, item);
  const logBase = { ts: ts, action: mode, user: u, scanZona: zone.id, role: a.role, device: item.device, offline: !!item.offline, clientId: item.clientId };
  if (!u) {
    queueLog_(ctx, Object.assign(logBase, { result: 'not_found', user: { plate: item.plate || '' }, detail: item.plate ? 'Matrícula introducida a mano' : 'QR no reconocido' }));
    return Object.assign(base, { result: 'not_found' });
  }
  const out = Object.assign(base, { user: staffUser_(u) });

  if (mode === 'entry') {
    if (u.status === 'in') {
      queueLog_(ctx, Object.assign(logBase, { result: 'already_in' }));
      return Object.assign(out, { result: 'already_in', entryTs: Number(u.entryTs) || null });
    }
    if (u.zona && u.zona !== zone.id) {
      queueLog_(ctx, Object.assign(logBase, { result: 'wrong_zone' }));
      return Object.assign(out, { result: 'wrong_zone' });
    }
    if (CONFIG.enforceCapacity && zone.capacity > 0) {
      const inside = ctx.users.filter(x => x.status === 'in' && x.zona === zone.id).length;
      if (inside >= zone.capacity) {
        queueLog_(ctx, Object.assign(logBase, { result: 'full' }));
        return Object.assign(out, { result: 'full' });
      }
    }
    setUser_(ctx, u, { status: 'in', entryTs: ts, updatedAt: now });
    queueLog_(ctx, Object.assign(logBase, { result: 'ok' }));
    out.user = staffUser_(u);
    return Object.assign(out, { result: 'ok', entryTs: ts });
  }

  // salida
  if (u.status !== 'in') {
    queueLog_(ctx, Object.assign(logBase, { result: 'not_in' }));
    return Object.assign(out, { result: 'not_in' });
  }
  if (u.zona && u.zona !== zone.id) {
    queueLog_(ctx, Object.assign(logBase, { result: 'wrong_zone' }));
    return Object.assign(out, { result: 'wrong_zone' });
  }
  const entryTs = Number(u.entryTs) || null;
  const duration = entryTs ? Math.max(0, Math.round((ts - entryTs) / 60000)) : '';
  setUser_(ctx, u, { status: 'out', entryTs: '', lastExitTs: ts, updatedAt: now });
  queueLog_(ctx, Object.assign(logBase, { result: 'ok', durationMin: duration }));
  out.user = staffUser_(u);
  return Object.assign(out, { result: 'ok', entryTs: entryTs, durationMin: duration });
}

function findUserForScan_(users, item) {
  if (item.qr) {
    const parsed = parseQr_(String(item.qr));
    if (!parsed) return null;
    if (parsed.token) return users.find(x => String(x.token) === parsed.token) || null;
    if (parsed.plate && CONFIG.allowLegacyQr) return users.find(x => norm_(x.plate) === parsed.plate) || null;
    return null;
  }
  if (item.plate) {
    const plate = norm_(item.plate);
    return users.find(x => norm_(x.plate) === plate) || null;
  }
  return null;
}

function parseQr_(raw) {
  raw = raw.trim();
  const m = /^CP2:([a-f0-9]{32})$/i.exec(raw);
  if (m) return { token: m[1].toLowerCase() };
  try {
    const o = JSON.parse(raw);
    if (o && o.plate) return { plate: norm_(o.plate) };
  } catch (e) { /* no es JSON */ }
  return null;
}

// ════════════════════════════════════════════════════════════════
//  VALIDACIÓN
// ════════════════════════════════════════════════════════════════
function validateRegistration_(d) {
  const errors = {};
  const out = {};
  const text = (k, label, min, max, required) => {
    const v = clean_(d[k], max);
    if (required && !v) errors[k] = label + ' es obligatorio';
    else if (v && v.length < min) errors[k] = label + ' es demasiado corto';
    out[k] = v;
  };
  text('nombre', 'El nombre', 2, 60, true);
  text('apellidos', 'Los apellidos', 2, 80, true);
  text('marca', 'La marca', 1, 40, false);
  text('modelo', 'El modelo', 1, 40, false);

  const zone = CONFIG.zones.find(z => z.id === d.zona);
  if (!zone) errors.zona = 'Elige una zona';
  out.zona = zone ? zone.id : '';

  const plate = norm_(d.plate);
  if (!plate) errors.plate = 'La matrícula es obligatoria';
  else if (!isValidPlate_(plate, !!d.foreignPlate)) errors.plate = d.foreignPlate ? 'Matrícula no válida' : 'Matrícula española no válida (ej. 1234 BCD)';
  out.plate = plate;

  const dni = norm_(d.dni);
  if (!dni && CONFIG.requireDni) errors.dni = 'El DNI/NIE es obligatorio';
  else if (dni && !isValidDni_(dni)) errors.dni = 'DNI/NIE no válido: revisa el número y la letra';
  out.dni = dni;

  const email = clean_(d.email, 120).toLowerCase();
  if (!email && CONFIG.requireEmail) errors.email = 'El email es obligatorio';
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Email no válido';
  out.email = email;

  const tel = String(d.telefono || '').replace(/[\s.-]/g, '');
  if (!tel && CONFIG.requirePhone) errors.telefono = 'El teléfono es obligatorio';
  else if (tel && !/^\+?[0-9]{9,15}$/.test(tel)) errors.telefono = 'Teléfono no válido';
  out.telefono = tel;

  const birth = String(d.nacimiento || '').trim();
  if (!birth && CONFIG.requireBirthDate) errors.nacimiento = 'La fecha de nacimiento es obligatoria';
  else if (birth) {
    const age = ageFrom_(birth);
    if (age === null || age > 110) errors.nacimiento = 'Fecha de nacimiento no válida';
    else if (CONFIG.minAge && age < CONFIG.minAge) errors.nacimiento = 'Debes tener al menos ' + CONFIG.minAge + ' años';
  }
  out.nacimiento = birth;

  if (d.consent !== true) errors.consent = 'Debes aceptar el tratamiento de datos';

  if (Object.keys(errors).length) throw fail_('validation', 'Revisa los campos marcados', errors);
  return out;
}

function isValidDni_(v) {
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  let m = /^([0-9]{8})([A-Z])$/.exec(v);
  if (m) return letters[Number(m[1]) % 23] === m[2];
  m = /^([XYZ])([0-9]{7})([A-Z])$/.exec(v);
  if (m) return letters[Number('XYZ'.indexOf(m[1]) + m[2]) % 23] === m[3];
  return false;
}

function isValidPlate_(p, foreign) {
  if (foreign) return /^[A-Z0-9]{3,10}$/.test(p);
  return /^[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(p)   // actual: 1234 BCD
    || /^[A-Z]{1,2}[0-9]{4}[A-Z]{1,2}$/.test(p)            // provincial: SE 1234 AB
    || /^[A-Z]{1,2}[0-9]{6}$/.test(p)                      // provincial antiguo: M 123456
    || /^[CER][0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(p); // ciclomotores, especiales, remolques
}

function ageFrom_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const today = new Date(Utilities.formatDate(new Date(), CONFIG.timezone, "yyyy-MM-dd'T'12:00:00"));
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  if (y < 1900 || age < 0) return null;
  return age;
}

// ════════════════════════════════════════════════════════════════
//  SESIONES Y SEGURIDAD
// ════════════════════════════════════════════════════════════════
function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function signSession_(role, expires) {
  const payload = role + '.' + expires + '.' + Utilities.getUuid().slice(0, 8);
  return payload + '.' + hmac_(payload);
}

function hmac_(value) {
  const sig = Utilities.computeHmacSha256Signature(value, secret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function auth_(p, roles) {
  const s = String(p.session || '');
  const i = s.lastIndexOf('.');
  if (i < 0) throw fail_('auth', 'Inicia sesión de nuevo');
  const payload = s.slice(0, i);
  if (!safeEqual_(s.slice(i + 1), hmac_(payload))) throw fail_('auth', 'Sesión no válida. Inicia sesión de nuevo');
  const parts = payload.split('.');
  const role = parts[0], expires = Number(parts[1]);
  if (!expires || expires < Date.now()) throw fail_('auth', 'La sesión ha caducado. Inicia sesión de nuevo');
  if (roles.indexOf(role) < 0) throw fail_('forbidden', 'No tienes permiso para esta acción');
  return { role: role, expires: expires };
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function rateLimit_(key, max, seconds, message) {
  const cache = CacheService.getScriptCache();
  const bucket = 'rl_' + key + '_' + Math.floor(Date.now() / (seconds * 1000));
  const n = Number(cache.get(bucket) || 0);
  if (n >= max) throw fail_('rate_limited', message);
  cache.put(bucket, String(n + 1), seconds + 5);
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 32).toLowerCase();
}

function lock_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw fail_('busy', 'El servidor está ocupado. Vuelve a intentarlo.');
  return lock;
}

// ════════════════════════════════════════════════════════════════
//  SALIDA DE DATOS
// ════════════════════════════════════════════════════════════════
function zoneName_(id) {
  const z = CONFIG.zones.find(x => x.id === id);
  return z ? z.name : (id || '');
}

function publicPass_(u) {
  return {
    token: String(u.token), plate: String(u.plate), nombre: u.nombre, apellidos: u.apellidos,
    marca: u.marca, modelo: u.modelo, zona: u.zona, zonaName: zoneName_(u.zona),
    status: u.status === 'in' ? 'in' : 'out', eventName: CONFIG.eventName,
  };
}

function staffUser_(u) {
  return {
    id: u.id, token: String(u.token), plate: String(u.plate), nombre: u.nombre, apellidos: u.apellidos,
    marca: u.marca, modelo: u.modelo, zona: u.zona, status: u.status === 'in' ? 'in' : 'out',
    entryTs: Number(u.entryTs) || null,
  };
}

function adminUser_(u) {
  return Object.assign(staffUser_(u), {
    dni: String(u.dni || ''), email: u.email, telefono: String(u.telefono || ''), nacimiento: String(u.nacimiento || ''),
    lastExitTs: Number(u.lastExitTs) || null, registeredAt: Number(u.registeredAt) || null,
  });
}

function logOut_(l) {
  return {
    ts: Number(l.ts), action: l.action, result: l.result, plate: String(l.plate || ''), userId: l.userId,
    nombre: l.nombre, zona: l.zona, scanZona: l.scanZona, durationMin: l.durationMin === '' ? null : Number(l.durationMin),
    role: l.role, offline: String(l.offline) === 'true' || l.offline === true, detail: l.detail,
  };
}

// ════════════════════════════════════════════════════════════════
//  HOJAS DE CÁLCULO
// ════════════════════════════════════════════════════════════════
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name, cols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), cols.length).setNumberFormat('@');
  }
  return sh;
}

function usersSheet_() { return sheet_(SHEET_USERS, USER_COLS); }
function logsSheet_() { return sheet_(SHEET_LOGS, LOG_COLS); }

function readAll_(sh, cols) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idx = cols.map(c => header.indexOf(c));
  const values = sh.getRange(2, 1, last - 1, header.length).getValues();
  return values.map((row, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = idx[j] >= 0 ? unsafe_(row[idx[j]]) : ''; });
    return o;
  }).filter(o => cols.some(c => o[c] !== ''));
}

function toRow_(cols, obj) {
  return cols.map(c => safeCell_(obj[c]));
}

function appendObj_(sh, cols, obj) {
  sh.appendRow(toRow_(cols, obj));
}

function setUser_(ctx, u, changes) {
  Object.assign(u, changes);
  ctx.sheet.getRange(u._row, 1, 1, USER_COLS.length).setValues([toRow_(USER_COLS, u)]);
}

function logRow_(e) {
  const u = e.user || {};
  return {
    ts: e.ts, fecha: Utilities.formatDate(new Date(e.ts), CONFIG.timezone, 'dd/MM/yyyy HH:mm:ss'),
    action: e.action, result: e.result, plate: u.plate || '', userId: u.id || '',
    nombre: [u.nombre, u.apellidos].filter(Boolean).join(' '), zona: u.zona || '', scanZona: e.scanZona || '',
    durationMin: e.durationMin === undefined ? '' : e.durationMin, role: e.role || '',
    device: String(e.device || '').slice(0, 40), offline: e.offline ? 'true' : 'false',
    clientId: String(e.clientId || '').slice(0, 64), detail: e.detail || '',
  };
}

function queueLog_(ctx, e) { ctx.logs.push(toRow_(LOG_COLS, logRow_(e))); }

function flushLogs_(ctx) {
  if (!ctx.logs.length) return;
  const sh = logsSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, ctx.logs.length, LOG_COLS.length).setValues(ctx.logs);
  ctx.logs = [];
}

// Evita que un texto empiece por = + - @ y Sheets lo interprete como fórmula
function safeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function unsafe_(v) {
  if (v instanceof Date) return v.getTime();
  return typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v;
}

function clean_(v, max) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 120);
}

function norm_(v) {
  return String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function startOfDay_(ts) {
  const d = Utilities.formatDate(new Date(ts), CONFIG.timezone, "yyyy-MM-dd'T'00:00:00XXX");
  return new Date(d).getTime();
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message, extra) {
  return { code: code, message: message, extra: extra };
}

function sendPassEmail_(u) {
  try {
    const link = CONFIG.appUrl + '#pase/' + u.token;
    MailApp.sendEmail({
      to: u.email,
      subject: CONFIG.eventName + ' · Tu pase de aparcamiento ' + u.plate,
      htmlBody: '<p>Hola ' + u.nombre + ',</p><p>Tu pase para la zona <b>' + zoneName_(u.zona) +
        '</b> con la matrícula <b>' + u.plate + '</b> está listo.</p><p><a href="' + link +
        '">Abrir mi pase</a></p><p>Enséñalo en la entrada y en la salida del aparcamiento.</p>',
    });
  } catch (e) {
    console.warn('No se pudo enviar el email: ' + e);
  }
}

// ════════════════════════════════════════════════════════════════
//  UTILIDADES DE INSTALACIÓN (ejecutar desde el editor)
// ════════════════════════════════════════════════════════════════

/** Ejecuta una vez: crea las hojas, la clave de sesión y contraseñas si no existen. */
function setup() {
  usersSheet_();
  logsSheet_();
  secret_();
  const props = PropertiesService.getScriptProperties();
  const gen = () => Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', gen());
  if (!props.getProperty('OPERATOR_PASSWORD')) props.setProperty('OPERATOR_PASSWORD', gen());
  Logger.log('Contraseña ADMIN: ' + props.getProperty('ADMIN_PASSWORD'));
  Logger.log('Contraseña OPERADOR: ' + props.getProperty('OPERATOR_PASSWORD'));
  Logger.log('Puedes cambiarlas en Configuración del proyecto → Propiedades del script.');
}

/**
 * Copia los registros de las hojas antiguas a «Usuarios» y «Movimientos».
 * No modifica ni borra las hojas antiguas. Se puede ejecutar varias veces sin duplicar datos.
 */
function migrarDatosAntiguos() {
  setup();
  const ss = ss_();
  const usersSh = usersSheet_();
  const existing = readAll_(usersSh, USER_COLS);
  const plates = {};
  existing.forEach(u => { plates[norm_(u.plate)] = true; });
  let added = 0, logsAdded = 0;
  const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== '') return o[k]; return ''; };
  const toTs = v => (v instanceof Date ? v.getTime() : (Number(v) || ''));
  const zoneId = v => {
    const s = String(v || '').trim().toLowerCase();
    const z = CONFIG.zones.find(x => x.id === s || x.name.toLowerCase() === s);
    return z ? z.id : '';
  };

  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (name === SHEET_USERS || name === SHEET_LOGS || sh.getLastRow() < 2) return;
    const values = sh.getDataRange().getValues();
    const header = values[0].map(h => String(h).toLowerCase().trim());
    const rows = values.slice(1).map(r => { const o = {}; header.forEach((h, i) => { o[h] = r[i]; }); return o; });

    const isLogSheet = header.indexOf('action') >= 0;
    if (!isLogSheet && (header.indexOf('plate') >= 0 || header.indexOf('matricula') >= 0 || header.indexOf('matrícula') >= 0)) {
      rows.forEach(r => {
        const plate = norm_(pick(r, ['plate', 'matricula', 'matrícula']));
        if (!plate || plates[plate]) return;
        plates[plate] = true;
        const now = Date.now();
        appendObj_(usersSh, USER_COLS, {
          id: Utilities.getUuid(), token: newToken_(), plate: plate,
          nombre: clean_(pick(r, ['nombre', 'name']), 60), apellidos: clean_(pick(r, ['apellidos', 'apellido', 'surname']), 80),
          nacimiento: pick(r, ['nacimiento', 'fechanac', 'birthday']) instanceof Date
            ? Utilities.formatDate(pick(r, ['nacimiento', 'fechanac', 'birthday']), CONFIG.timezone, 'yyyy-MM-dd')
            : String(pick(r, ['nacimiento', 'fechanac', 'birthday'])),
          dni: norm_(pick(r, ['dni'])), email: String(pick(r, ['email', 'correo'])).trim().toLowerCase(),
          telefono: String(pick(r, ['telefono', 'teléfono', 'phone'])).replace(/\s/g, ''),
          marca: clean_(pick(r, ['marca', 'brand']), 40), modelo: clean_(pick(r, ['modelo', 'model']), 40),
          zona: zoneId(pick(r, ['zona', 'zone'])),
          status: String(pick(r, ['status'])) === 'in' ? 'in' : 'out',
          entryTs: String(pick(r, ['status'])) === 'in' ? toTs(pick(r, ['entryts'])) : '',
          lastExitTs: '', registeredAt: now, consentAt: '', updatedAt: now,
        });
        added++;
      });
    } else if (isLogSheet) {
      const flag = 'MIGRATED_LOGS_' + name;
      const props = PropertiesService.getScriptProperties();
      if (props.getProperty(flag)) return; // ya migrada: no duplicar movimientos
      props.setProperty(flag, String(Date.now()));
      const logsSh = logsSheet_();
      const batch = [];
      rows.forEach(r => {
        const ts = toTs(r.ts) || Date.now();
        batch.push(toRow_(LOG_COLS, logRow_({
          ts: ts, action: r.manual ? 'manual_exit' : String(r.action), result: 'ok',
          user: { plate: norm_(r.plate), nombre: String(r.name || ''), zona: zoneId(r.zona) },
          durationMin: r.duration === undefined ? '' : r.duration, role: 'legacy', detail: 'Migrado de la hoja ' + name,
        })));
      });
      if (batch.length) {
        logsSh.getRange(logsSh.getLastRow() + 1, 1, batch.length, LOG_COLS.length).setValues(batch);
        logsAdded += batch.length;
      }
    }
  });
  Logger.log('Usuarios migrados: ' + added + ' · Movimientos migrados: ' + logsAdded);
}
