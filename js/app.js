// Arranque, navegación y cabecera.
import { api, session } from './api.js';
import { DEFAULT_CONFIG, APP_VERSION } from './config.js';
import { store, $, html } from './util.js';
import { toast, closeDialog } from './ui.js';
import { offline } from './offline.js';

const ROUTES = {
  registro: () => import('./views/register.js'),
  pase: () => import('./views/pass.js'),
  recuperar: () => import('./views/recover.js'),
  acceso: () => import('./views/login.js'),
  escaner: () => import('./views/scanner.js'),
  panel: () => import('./views/admin.js'),
};
const STAFF = { escaner: ['operator', 'admin'], panel: ['admin'] };
const ALIASES = { '': 'registro', register: 'registro', scan: 'escaner', admin: 'panel' };

export const app = {
  config: store.get('cp_config') || DEFAULT_CONFIG,
  go(path) { location.hash = '#' + path; },
};

let cleanup = null;
let renderId = 0;

async function route() {
  const id = ++renderId;
  closeDialog();
  const [rawName, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  let name = ALIASES[rawName] ?? rawName;
  if (!rawName) name = session.role() ? 'escaner' : (store.get('cp_pass') ? 'pase' : 'registro');
  if (!ROUTES[name]) { app.go('registro'); return; }
  const roles = STAFF[name];
  if (roles && !roles.includes(session.role())) {
    app.go(session.role() ? 'escaner' : 'acceso');
    return;
  }
  if (cleanup) { try { cleanup(); } catch { /* vista ya cerrada */ } cleanup = null; }
  renderNav(name);
  document.body.dataset.view = name;
  const root = $('#view');
  const mod = await ROUTES[name]();
  if (id !== renderId) return;
  root.innerHTML = '';
  root.scrollTop = 0;
  window.scrollTo(0, 0);
  cleanup = (await mod.mount(root, { config: app.config, params: rest, go: app.go })) || null;
  root.focus({ preventScroll: true });
}

function renderNav(current) {
  const role = session.role();
  const link = (path, label) => html`<a href="#${path}" class="nav__link" ${current === path ? html`aria-current="page"` : ''}>${label}</a>`;
  const items = [];
  if (!role) {
    items.push(link('registro', 'Registro'), link('pase', 'Mi pase'), link('acceso', 'Personal'));
  } else {
    items.push(link('escaner', 'Escáner'));
    if (role === 'admin') items.push(link('panel', 'Panel'));
    items.push(html`<button type="button" class="nav__link nav__logout" id="logout">Salir</button>`);
  }
  $('#nav').innerHTML = items.join('');
  $('#event-name').textContent = app.config.eventName && app.config.eventName !== 'ControlPark' ? app.config.eventName : '';
  $('#logout')?.addEventListener('click', logout);
}

function logout() {
  if (offline.pending()) {
    toast(`Hay ${offline.pending()} movimientos sin enviar. Conéctate a internet antes de salir.`, 'warn', 5000);
    return;
  }
  session.clear();
  store.del('cp_snapshot');
  toast('Sesión cerrada');
  app.go('acceso');
}

async function loadConfig() {
  try {
    const cfg = await api('config', {}, { timeout: 10000 });
    const changed = JSON.stringify(cfg) !== JSON.stringify(app.config);
    app.config = cfg;
    store.set('cp_config', cfg);
    if (changed && ['registro', 'escaner'].includes(document.body.dataset.view)) route();
    else renderNav(document.body.dataset.view);
  } catch { /* se mantiene la configuración guardada */ }
}

function connectivity() {
  const set = () => document.body.classList.toggle('is-offline', navigator.onLine === false);
  window.addEventListener('online', () => { set(); offline.sync().catch(() => {}); });
  window.addEventListener('offline', set);
  set();
}

function serviceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = worker => {
      const bar = $('#update');
      bar.hidden = false;
      $('#update-btn').onclick = () => worker.postMessage('skipWaiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

window.addEventListener('cp:session', () => renderNav(document.body.dataset.view));
window.addEventListener('hashchange', route);
window.addEventListener('cp:sync', e => {
  const { sent, conflicts } = e.detail;
  if (!sent) return;
  if (conflicts.length) toast(`Enviados ${sent} movimientos. ${conflicts.length} no se pudieron aplicar: revísalos en el panel.`, 'warn', 6000);
  else toast(`Enviados ${sent} movimientos pendientes`, 'ok');
});

document.documentElement.dataset.version = APP_VERSION;
$('#dialog-x').addEventListener('click', closeDialog);
$('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(); });
connectivity();
serviceWorker();
route();
loadConfig();
