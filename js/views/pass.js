import { api } from '../api.js';
import { html, raw, $, store } from '../util.js';
import { plate, toast, icon, setBusy } from '../ui.js';
import { qrSvg, qrPayload } from '../qr.js';
import { downloadPassPdf } from '../pdf.js';

export async function mount(root, { params }) {
  const token = (params[0] || '').toLowerCase();
  let pass = store.get('cp_pass');
  if (token && pass?.token !== token) pass = null;

  if (!token && !pass) {
    root.innerHTML = html`
      <section class="page page--narrow">
        <div class="empty">
          <h1 class="empty__title">No hay ningún pase en este móvil</h1>
          <p>Regístrate para conseguir uno, o recupéralo si ya te registraste desde otro dispositivo.</p>
          <div class="empty__actions">
            <a class="btn btn--primary" href="#registro">Registrar mi vehículo</a>
            <a class="btn btn--ghost" href="#recuperar">Recuperar mi pase</a>
          </div>
        </div>
      </section>`;
    return;
  }

  if (pass) render(root, pass, 'cached');
  else root.innerHTML = html`<div class="boot"><span class="spinner" aria-hidden="true"></span> Abriendo tu pase</div>`;

  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }

  try {
    const fresh = await api('pass', { token: token || pass.token });
    store.set('cp_pass', fresh);
    render(root, fresh, 'live');
  } catch (err) {
    if (err.code === 'pass_not_found') {
      if (store.get('cp_pass')?.token === (token || pass?.token)) store.del('cp_pass');
      root.innerHTML = html`
        <section class="page page--narrow">
          <div class="empty">
            <h1 class="empty__title">Este pase ya no es válido</h1>
            <p>${err.message} Recupera el pase actual con tu DNI y tu email.</p>
            <div class="empty__actions"><a class="btn btn--primary" href="#recuperar">Recuperar mi pase</a></div>
          </div>
        </section>`;
    } else if (!pass) {
      root.innerHTML = html`
        <section class="page page--narrow"><div class="empty">
          <h1 class="empty__title">No se ha podido abrir el pase</h1>
          <p>${err.network ? 'Necesitas conexión la primera vez que abres un pase en este móvil.' : err.message}</p>
          <div class="empty__actions"><button class="btn btn--primary" id="retry" type="button">Reintentar</button></div>
        </div></section>`;
      $('#retry', root).onclick = () => mount(root, { params });
    } else {
      const s = $('#pass-status', root);
      if (s) s.dataset.sync = 'offline';
    }
  }

  return () => { try { wake?.release(); } catch { /* ya liberado */ } };
}

function render(root, p, state) {
  const inside = p.status === 'in';
  const car = [p.marca, p.modelo].filter(Boolean).join(' ');
  root.innerHTML = html`
  <section class="page page--narrow">
    <article class="ticket" aria-label="Pase de aparcamiento">
      <header class="ticket__head">
        <img src="icons/icon-192.png" alt="" width="40" height="40">
        <div>
          <p class="ticket__event">${p.eventName || 'ControlPark'}</p>
          <p class="ticket__kind">Pase de aparcamiento</p>
        </div>
      </header>
      <div class="ticket__qr">${raw(qrSvg(qrPayload(p.token)))}</div>
      <div class="ticket__plate">${plate(p.plate, 'lg')}</div>
      <dl class="ticket__facts">
        <div><dt>Titular</dt><dd>${p.nombre} ${p.apellidos}</dd></div>
        <div><dt>Zona</dt><dd>${p.zonaName || '—'}</dd></div>
        ${car ? html`<div><dt>Vehículo</dt><dd>${car}</dd></div>` : ''}
      </dl>
      <p class="ticket__status ${inside ? 'is-in' : ''}" id="pass-status" data-sync="${state}">
        <span class="dot" aria-hidden="true"></span>
        ${inside ? 'Dentro del aparcamiento' : 'Listo para entrar'}
      </p>
    </article>

    <p class="hint">Sube el brillo de la pantalla al enseñarlo. El pase queda guardado en este móvil y funciona sin conexión.</p>

    <div class="actions">
      <button class="btn btn--primary" id="pdf" type="button">${raw(icon.download)} Descargar en PDF</button>
      <button class="btn btn--ghost" id="share" type="button">${raw(icon.share)} Enviar el enlace</button>
    </div>
    <p class="hint hint--small">Quien tenga el enlace o el QR puede usar tu pase. No lo publiques.</p>
  </section>`;

  $('#pdf', root).onclick = async e => {
    setBusy(e.currentTarget, true, 'Preparando PDF');
    try { await downloadPassPdf(p); } catch { toast('No se pudo crear el PDF. Inténtalo con conexión.', 'error'); }
    setBusy(e.currentTarget, false);
  };
  $('#share', root).onclick = async () => {
    const url = location.href.split('#')[0] + '#pase/' + p.token;
    try {
      if (navigator.share) await navigator.share({ title: 'Mi pase de aparcamiento', url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); }
    } catch (err) {
      if (err.name !== 'AbortError') toast('No se pudo compartir el enlace', 'error');
    }
  };
}
