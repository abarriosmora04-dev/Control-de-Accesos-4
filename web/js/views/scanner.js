import { api, session } from '../api.js';
import { html, raw, $, $$, store, uid, deviceId, normPlate, fmtTime, fmtDuration, ago } from '../util.js';
import { plate, toast, icon, openDialog, closeDialog } from '../ui.js';
import { Camera } from '../camera.js';
import { offline } from '../offline.js';
import { parseQr } from '../qr.js';
import { signal, unlockAudio } from '../feedback.js';

const PREFS = 'cp_scan_prefs';

export async function mount(root, { config, go }) {
  const prefs = store.get(PREFS, { zona: null, mode: 'entry' });
  if (!config.zones.some(z => z.id === prefs.zona)) prefs.zona = config.zones.length === 1 ? config.zones[0].id : null;
  const recent = [];
  let camera = null;
  let wantCamera = false;
  let lastValue = '', lastValueAt = 0;
  let verdictTimer = null;
  let processing = false;

  root.innerHTML = html`
  <section class="scanner" data-mode="${prefs.mode}">
    <h1 class="sr-only">Escáner de pases</h1>
    <div class="scanner__controls">
      <div class="seg" role="radiogroup" aria-label="Zona de este control">
        ${config.zones.map(z => html`<button type="button" class="seg__btn" role="radio" data-zona="${z.id}" aria-checked="${prefs.zona === z.id}">${z.name}</button>`)}
      </div>
      <div class="mode" role="radiogroup" aria-label="Sentido">
        <button type="button" class="mode__btn mode__btn--entry" role="radio" data-mode="entry" aria-checked="${prefs.mode === 'entry'}">${raw(icon.in)}<span>Entrada</span></button>
        <button type="button" class="mode__btn mode__btn--exit" role="radio" data-mode="exit" aria-checked="${prefs.mode === 'exit'}">${raw(icon.out)}<span>Salida</span></button>
      </div>
    </div>

    <div class="viewport" id="viewport">
      <video id="cam" muted playsinline aria-hidden="true"></video>
      <div class="viewport__frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="viewport__label" id="vp-label" aria-hidden="true"></div>
      <div class="viewport__idle" id="idle">
        ${raw(icon.camera)}
        <p id="idle-text"></p>
        <button type="button" class="btn btn--primary btn--lg" id="start">Activar cámara</button>
      </div>
      <div class="viewport__tools">
        <button type="button" class="tool" id="torch" hidden aria-pressed="false">${raw(icon.torch)}<span>Linterna</span></button>
        <button type="button" class="tool" id="manual">${raw(icon.keyboard)}<span>Escribir matrícula</span></button>
      </div>
    </div>

    <div class="scanner__status" id="status" role="status"></div>

    <h2 class="scanner__subtitle">Últimos escaneos</h2>
    <ol class="recent" id="recent"><li class="recent__empty">Todavía no has escaneado ningún pase.</li></ol>
  </section>

  <div class="verdict" id="verdict" hidden role="alert" tabindex="-1"></div>`;

  const sc = $('.scanner', root);
  const verdict = $('#verdict', root);

  // ── Controles ──
  const savePrefs = () => store.set(PREFS, prefs);
  const updateControls = () => {
    sc.dataset.mode = prefs.mode;
    $$('[data-zona]', root).forEach(b => b.setAttribute('aria-checked', String(b.dataset.zona === prefs.zona)));
    $$('[data-mode]', root).forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === prefs.mode)));
    const z = config.zones.find(x => x.id === prefs.zona);
    $('#vp-label', root).textContent = z ? `${prefs.mode === 'entry' ? 'Entrada' : 'Salida'} en ${z.name}` : '';
    $('#idle-text', root).textContent = z ? 'Activa la cámara o usa un lector conectado.' : 'Elige primero la zona de este control.';
    $('#start', root).disabled = !z;
  };
  root.addEventListener('click', e => {
    const zb = e.target.closest('[data-zona]');
    const mb = e.target.closest('[data-mode]');
    if (zb) { prefs.zona = zb.dataset.zona; savePrefs(); updateControls(); }
    if (mb) { prefs.mode = mb.dataset.mode; savePrefs(); updateControls(); signal('ok'); }
  });
  updateControls();

  // ── Cámara ──
  async function startCamera() {
    if (!prefs.zona) { toast('Elige la zona de este control', 'warn'); return; }
    unlockAudio();
    wantCamera = true;
    try {
      camera = camera || new Camera($('#cam', root), onCode);
      await camera.start();
      sc.classList.add('is-live');
      const torch = $('#torch', root);
      torch.hidden = !camera.hasTorch();
    } catch (e) {
      wantCamera = false;
      camera = null;
      const msg = e.name === 'NotAllowedError'
        ? 'Has bloqueado la cámara. Permite el acceso en los ajustes del navegador y vuelve a intentarlo.'
        : e.name === 'NotFoundError' ? 'No se encuentra ninguna cámara en este dispositivo.' : (e.message || 'No se pudo abrir la cámara.');
      $('#idle-text', root).textContent = msg;
      toast(msg, 'error', 5000);
    }
  }
  function stopCamera() {
    camera?.stop();
    camera = null;
    sc.classList.remove('is-live');
    $('#torch', root).hidden = true;
  }
  $('#start', root).onclick = startCamera;
  $('#torch', root).onclick = async e => {
    const btn = e.currentTarget;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    if (await camera?.setTorch(on)) btn.setAttribute('aria-pressed', String(on));
  };
  $('#manual', root).onclick = manualEntry;

  const onVisibility = () => {
    if (document.hidden) { if (camera) { stopCamera(); wantCamera = true; } }
    else if (wantCamera && !camera) startCamera();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ── Lector físico (pistola o PDA en modo teclado) ──
  let wedge = '', wedgeLast = 0, wedgeSeen = false;
  const onKey = e => {
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    const now = Date.now();
    if (now - wedgeLast > 120) wedge = '';
    wedgeLast = now;
    if (e.key === 'Enter' || e.key === 'Tab') {
      const value = wedge.trim();
      wedge = '';
      if (value.length >= 8) {
        e.preventDefault();
        if (!wedgeSeen) { wedgeSeen = true; refreshStatus(); }
        if (!verdict.hidden) hideVerdict();
        unlockAudio();
        lastValueAt = 0;
        onCode(value);
      }
      return;
    }
    if (e.key.length === 1) wedge += e.key;
  };
  document.addEventListener('keydown', onKey);

  // ── Lectura ──
  function onCode(value) {
    const now = Date.now();
    if (processing || !verdict.hidden) return;
    if (value === lastValue && now - lastValueAt < 4000) return;
    lastValue = value; lastValueAt = now;
    const parsed = parseQr(value);
    if (!parsed) { show({ result: 'invalid_qr' }); return; }
    process({ qr: value });
  }

  async function process(input) {
    if (!prefs.zona) { toast('Elige la zona de este control', 'warn'); return; }
    processing = true;
    if (camera) camera.paused = true;
    const item = { ...input, mode: prefs.mode, zona: prefs.zona, ts: Date.now(), clientId: uid(), device: deviceId() };
    let res;
    try {
      if (offline.pending() && navigator.onLine !== false) await offline.sync().catch(() => {});
      if (navigator.onLine === false || offline.pending()) throw Object.assign(new Error('offline'), { network: true });
      res = await api('scan', item, { timeout: 7000 });
      if (res.user) offline.updateUser(res.user);
    } catch (e) {
      if (e.network) res = offline.evaluate(item);
      else if (e.code === 'auth') { processing = false; toast(e.message, 'error'); go('acceso'); return; }
      else res = { result: 'error', message: e.message };
    }
    processing = false;
    show(res);
    refreshStatus();
  }

  function manualEntry() {
    openDialog(html`
      <h2 class="dialog__title">Escribir matrícula</h2>
      <p class="dialog__text">Para pases dañados o móviles sin batería. Se comprueba igual que un QR.</p>
      <form id="manual-form" novalidate>
        <div class="plate-input">
          <span class="plate__eu" aria-hidden="true"><span class="plate__stars"></span><b>E</b></span>
          <input class="plate-input__field" id="m-plate" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12" placeholder="1234 BCD" aria-label="Matrícula">
        </div>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" id="m-cancel">Cancelar</button>
          <button type="submit" class="btn btn--primary">Comprobar</button>
        </div>
      </form>`);
    const input = $('#m-plate');
    input.focus();
    $('#m-cancel').onclick = closeDialog;
    $('#manual-form').onsubmit = e => {
      e.preventDefault();
      const p = normPlate(input.value);
      if (p.length < 3) { input.focus(); return; }
      closeDialog();
      process({ plate: p });
    };
  }

  // ── Veredicto a pantalla completa ──
  function describe(r) {
    const zoneName = id => config.zones.find(z => z.id === id)?.name || id || '';
    const u = r.user;
    switch (r.result) {
      case 'ok': return r.mode === 'entry'
        ? { kind: 'ok', title: 'Puede entrar', detail: `Entrada registrada a las ${fmtTime(r.entryTs || r.ts)}` }
        : { kind: 'ok', title: 'Puede salir', detail: r.durationMin !== null && r.durationMin !== undefined && r.durationMin !== '' ? `Ha estado ${fmtDuration(r.durationMin)}` : 'Salida registrada' };
      case 'already_in': return { kind: 'warn', title: 'Ya está dentro', detail: r.entryTs ? `Entró a las ${fmtTime(r.entryTs)}. El pase no vale para otra entrada hasta que salga.` : 'El pase no vale para otra entrada hasta que salga.' };
      case 'not_in': return { kind: 'warn', title: 'No consta la entrada', detail: 'Este vehículo no tiene una entrada registrada. Si estaba dentro, avisa a administración.' };
      case 'wrong_zone': return { kind: 'deny', title: 'Zona equivocada', detail: `Su pase es para ${zoneName(u?.zona)}.` };
      case 'full': return { kind: 'deny', title: 'Zona completa', detail: 'No quedan plazas en esta zona.' };
      case 'not_found': return { kind: 'deny', title: 'Pase no válido', detail: r.offline ? 'No está en la copia de este móvil. Puede ser un registro muy reciente: compruébalo cuando vuelva la conexión.' : 'No corresponde a ningún pase activo. Puede ser falso o haber sido renovado.' };
      case 'invalid_qr': return { kind: 'deny', title: 'QR no reconocido', detail: 'No es un pase de ControlPark.' };
      case 'no_snapshot': return { kind: 'deny', title: 'Sin datos para validar', detail: 'No hay conexión y este móvil aún no ha descargado los pases. Conéctate a internet un momento.' };
      default: return { kind: 'deny', title: 'No se ha podido comprobar', detail: r.message || 'Vuelve a intentarlo.' };
    }
  }

  function show(r) {
    const d = describe(r);
    const u = r.user;
    signal(d.kind);
    verdict.className = `verdict verdict--${d.kind}`;
    verdict.innerHTML = String(html`
      <div class="verdict__icon">${raw(d.kind === 'ok' ? icon.check : d.kind === 'warn' ? icon.warn : icon.cross)}</div>
      <p class="verdict__title">${d.title}</p>
      ${u ? html`<div class="verdict__plate">${plate(u.plate, 'lg')}</div>
        <p class="verdict__who">${u.nombre} ${u.apellidos}</p>
        ${u.marca || u.modelo ? html`<p class="verdict__car">${[u.marca, u.modelo].filter(Boolean).join(' ')}</p>` : ''}` : (r.plate ? html`<div class="verdict__plate">${plate(r.plate, 'lg')}</div>` : '')}
      <p class="verdict__detail">${d.detail}</p>
      ${r.offline && r.result === 'ok' ? html`<p class="verdict__offline">${raw(icon.offline)} Sin conexión. Se enviará al volver la red.</p>` : ''}
      <p class="verdict__tap">Toca para seguir</p>`);
    verdict.hidden = false;
    verdict.focus();
    addRecent(r, d);
    clearTimeout(verdictTimer);
    verdictTimer = setTimeout(hideVerdict, d.kind === 'ok' ? 1800 : 4000);
  }
  function hideVerdict() {
    clearTimeout(verdictTimer);
    verdict.hidden = true;
    if (camera) camera.paused = false;
    lastValueAt = Date.now() - 2500; // permite volver a leer el mismo QR en 1,5 s
  }
  verdict.addEventListener('click', hideVerdict);
  verdict.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') hideVerdict(); });

  function addRecent(r, d) {
    recent.unshift({ r, d, at: Date.now() });
    recent.length = Math.min(recent.length, 8);
    $('#recent', root).innerHTML = recent.map(({ r: x, d: y, at }) => String(html`
      <li class="recent__item recent__item--${y.kind}">
        <span class="recent__mark" aria-hidden="true">${raw(y.kind === 'ok' ? icon.check : y.kind === 'warn' ? icon.warn : icon.cross)}</span>
        <span class="recent__plate">${x.user?.plate || x.plate ? plate(x.user?.plate || x.plate, 'sm') : 'QR desconocido'}</span>
        <span class="recent__what">${y.title}${x.offline && x.result === 'ok' ? ' (pendiente de enviar)' : ''}</span>
        <time class="recent__time">${fmtTime(at)}</time>
      </li>`)).join('');
  }

  // ── Estado de conexión y copia local ──
  function refreshStatus() {
    const snap = offline.snapshot();
    const pending = offline.pending();
    const online = navigator.onLine !== false;
    const zone = prefs.zona;
    const inside = snap && zone ? snap.users.filter(u => u.status === 'in' && u.zona === zone).length : null;
    $('#status', root).innerHTML = String(html`
      <span class="pill ${online ? 'pill--ok' : 'pill--warn'}"><span class="dot" aria-hidden="true"></span>${online ? 'En línea' : 'Sin conexión'}</span>
      ${pending ? html`<span class="pill pill--warn">${pending} sin enviar</span>` : ''}
      ${inside !== null ? html`<span class="pill">${inside} dentro de esta zona</span>` : ''}
      ${wedgeSeen ? html`<span class="pill pill--ok">Lector conectado</span>` : ''}
      <span class="scanner__snap">${snap ? `Pases descargados ${ago(snap.at)}` : 'Sin copia local de pases'}</span>`);
  }

  async function refreshData() {
    if (navigator.onLine === false) { refreshStatus(); return; }
    try {
      await offline.sync();
      await offline.refresh();
    } catch (e) {
      if (e.code === 'auth') { toast(e.message, 'error'); go('acceso'); return; }
    }
    refreshStatus();
  }

  const onQueue = () => refreshStatus();
  const onOnline = () => refreshData();
  window.addEventListener('cp:queue', onQueue);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onQueue);
  const timer = setInterval(refreshData, 60000);
  const statusTimer = setInterval(refreshStatus, 15000);
  refreshStatus();
  refreshData();

  if (!session.get()) go('acceso');
  if (store.get('cp_cam_auto') && prefs.zona) startCamera();

  return () => {
    store.set('cp_cam_auto', !!camera);
    stopCamera();
    clearTimeout(verdictTimer);
    clearInterval(timer);
    clearInterval(statusTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('cp:queue', onQueue);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onQueue);
  };
}
