import { api } from '../api.js';
import { html, raw, $, $$, fmtWhen, fmtTime, fmtDuration, ago, debounce, toCsv, download, formatPlate } from '../util.js';
import { plate, toast, icon, openDialog, closeDialog, confirmDialog, setBusy } from '../ui.js';
import { qrSvg, qrPayload } from '../qr.js';
import { downloadPassPdf } from '../pdf.js';

const ACTION_LABEL = { entry: 'Entrada', exit: 'Salida', manual_exit: 'Salida manual', revoke: 'QR renovado', delete: 'Datos borrados' };
const RESULT_LABEL = { ok: '', already_in: 'ya estaba dentro', not_in: 'no constaba la entrada', wrong_zone: 'zona equivocada', not_found: 'pase no válido', full: 'zona completa' };

export async function mount(root) {
  let data = null;
  let loadedAt = 0;
  const filters = { q: '', zona: 'all', status: 'all', onlyIssues: false };

  root.innerHTML = html`
  <section class="page page--wide admin">
    <header class="admin__head">
      <div>
        <h1 class="intro__title">Panel</h1>
        <p class="admin__updated" id="updated">Cargando datos</p>
      </div>
      <div class="admin__tools">
        <button class="btn btn--ghost btn--sm" id="reload" type="button">${raw(icon.refresh)} Actualizar</button>
        <button class="btn btn--ghost btn--sm" id="csv-users" type="button">${raw(icon.download)} Usuarios</button>
        <button class="btn btn--ghost btn--sm" id="csv-logs" type="button">${raw(icon.download)} Movimientos</button>
      </div>
    </header>
    <div id="occupancy" class="occupancy"></div>
    <div class="admin__row">
      <div class="panel">
        <h2 class="panel__title">Últimas 12 horas</h2>
        <div id="chart" class="chart"></div>
      </div>
      <div class="panel" id="today"></div>
    </div>

    <div class="panel">
      <div class="panel__bar">
        <h2 class="panel__title">Vehículos registrados <span class="count" id="count"></span></h2>
        <div class="filters">
          <input class="input input--sm" id="q" type="search" placeholder="Buscar matrícula, nombre, DNI o email" aria-label="Buscar">
          <select class="input input--sm" id="fz" aria-label="Zona"><option value="all">Todas las zonas</option></select>
          <select class="input input--sm" id="fs" aria-label="Estado">
            <option value="all">Dentro y fuera</option><option value="in">Solo dentro</option><option value="out">Solo fuera</option>
          </select>
        </div>
      </div>
      <div id="users"></div>
    </div>

    <div class="panel">
      <div class="panel__bar">
        <h2 class="panel__title">Actividad</h2>
        <label class="check check--inline"><input type="checkbox" id="issues"> Solo incidencias</label>
      </div>
      <ol id="log" class="log"></ol>
    </div>
  </section>`;

  async function load(manual) {
    const btn = $('#reload', root);
    if (manual) setBusy(btn, true, 'Actualizando');
    try {
      data = await api('dashboard', {}, { timeout: 25000 });
      loadedAt = Date.now();
      const fz = $('#fz', root);
      if (fz.options.length === 1) data.config.zones.forEach(z => fz.add(new Option(z.name, z.id)));
      renderAll();
    } catch (e) {
      $('#updated', root).textContent = e.network ? 'Sin conexión. Mostrando los últimos datos cargados.' : e.message;
      if (!data) $('#users', root).innerHTML = String(html`<p class="empty-line">${e.message}</p>`);
    } finally {
      if (manual) setBusy(btn, false);
    }
  }

  const zoneName = id => data?.config.zones.find(z => z.id === id)?.name || id || 'Sin zona';

  function renderAll() {
    $('#updated', root).textContent = `Actualizado ${ago(loadedAt)}`;
    renderOccupancy();
    renderToday();
    renderChart();
    renderUsers();
    renderLog();
  }

  function renderOccupancy() {
    const el = $('#occupancy', root);
    el.innerHTML = data.config.zones.map(z => {
      const inside = data.users.filter(u => u.status === 'in' && u.zona === z.id).length;
      const reg = data.users.filter(u => u.zona === z.id).length;
      const cap = z.capacity || 0;
      return String(html`
        <div class="occ ${cap && inside >= cap ? 'is-full' : ''}">
          <p class="occ__zone">${z.name}</p>
          <p class="occ__num"><strong>${inside}</strong>${cap ? html` <span>de ${cap} plazas</span>` : html` <span>dentro</span>`}</p>
          ${cap ? html`<div class="bar" data-v="${Math.min(100, Math.round(inside / cap * 100))}"><i></i></div>` : ''}
          <p class="occ__meta">${reg === 1 ? '1 vehículo registrado' : `${reg} vehículos registrados`} en esta zona</p>
        </div>`);
    }).join('');
    $$('.bar', el).forEach(b => b.style.setProperty('--v', b.dataset.v + '%'));
  }

  function renderToday() {
    const s = data.stats;
    $('#today', root).innerHTML = String(html`
      <h2 class="panel__title">Hoy</h2>
      <dl class="kv">
        <div><dt>Entradas</dt><dd>${s.entriesToday}</dd></div>
        <div><dt>Salidas</dt><dd>${s.exitsToday}</dd></div>
        <div><dt>Dentro ahora</dt><dd>${data.users.filter(u => u.status === 'in').length}</dd></div>
        <div><dt>Registrados</dt><dd>${data.users.length}</dd></div>
      </dl>`);
  }

  function renderChart() {
    const h = data.stats.hourly;
    const max = Math.max(1, ...h.map(b => Math.max(b.entries, b.exits)));
    const W = 600, H = 150, pad = 22, bw = (W - pad) / h.length;
    const bars = h.map((b, i) => {
      const x = pad + i * bw;
      const he = (b.entries / max) * (H - 30), hx = (b.exits / max) * (H - 30);
      return `<rect class="c-in" x="${x + bw * 0.14}" y="${H - 18 - he}" width="${bw * 0.33}" height="${he}" rx="2"><title>${fmtTime(b.from)}: ${b.entries} entradas</title></rect>`
        + `<rect class="c-out" x="${x + bw * 0.52}" y="${H - 18 - hx}" width="${bw * 0.33}" height="${hx}" rx="2"><title>${fmtTime(b.from)}: ${b.exits} salidas</title></rect>`
        + (i % 2 === 0 ? `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${fmtTime(b.from).slice(0, 2)}h</text>` : '');
    }).join('');
    $('#chart', root).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas y salidas por hora en las últimas 12 horas">
      <line x1="${pad}" x2="${W}" y1="${H - 18}" y2="${H - 18}" class="c-axis"/>
      <text x="0" y="12" class="c-max">${max}</text>${bars}</svg>
      <p class="legend"><span class="legend__in"></span>Entradas <span class="legend__out"></span>Salidas</p>`;
  }

  function filteredUsers() {
    const q = filters.q.toLowerCase().replace(/\s/g, '');
    return data.users.filter(u => {
      if (filters.zona !== 'all' && u.zona !== filters.zona) return false;
      if (filters.status !== 'all' && u.status !== filters.status) return false;
      if (!q) return true;
      return [u.plate, u.nombre + u.apellidos, u.dni, u.email, u.telefono].some(v => String(v || '').toLowerCase().replace(/\s/g, '').includes(q));
    }).sort((a, b) => (b.status === 'in') - (a.status === 'in') || (b.entryTs || b.registeredAt || 0) - (a.entryTs || a.registeredAt || 0));
  }

  function renderUsers() {
    const list = filteredUsers();
    $('#count', root).textContent = list.length === data.users.length ? `(${list.length})` : `(${list.length} de ${data.users.length})`;
    if (!list.length) {
      $('#users', root).innerHTML = String(html`<p class="empty-line">${data.users.length ? 'Ningún vehículo coincide con la búsqueda.' : 'Todavía no hay vehículos registrados. Comparte el enlace de registro para empezar.'}</p>`);
      return;
    }
    const shown = list.slice(0, 300);
    $('#users', root).innerHTML = String(html`
      <table class="table">
        <thead><tr><th>Matrícula</th><th>Titular</th><th>Zona</th><th>Vehículo</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          ${shown.map(u => html`
            <tr>
              <td data-label="Matrícula">${plate(u.plate, 'sm')}</td>
              <td data-label="Titular">${u.nombre} ${u.apellidos}</td>
              <td data-label="Zona">${zoneName(u.zona)}</td>
              <td data-label="Vehículo">${[u.marca, u.modelo].filter(Boolean).join(' ') || '—'}</td>
              <td data-label="Estado">${u.status === 'in'
                ? html`<span class="pill pill--in"><span class="dot"></span>Dentro desde ${fmtWhen(u.entryTs)}</span>`
                : html`<span class="pill">Fuera${u.lastExitTs ? `, salió ${fmtWhen(u.lastExitTs)}` : ''}</span>`}</td>
              <td><button class="btn btn--ghost btn--sm" data-open="${u.id}" type="button">Ver ficha</button></td>
            </tr>`)}
        </tbody>
      </table>
      ${list.length > shown.length ? html`<p class="empty-line">Se muestran 300 de ${list.length}. Afina la búsqueda para ver el resto.</p>` : ''}`);
  }

  function renderLog() {
    const logs = data.logs.filter(l => !filters.onlyIssues || l.result !== 'ok');
    $('#log', root).innerHTML = logs.length ? logs.slice(0, 150).map(l => String(html`
      <li class="log__item ${l.result !== 'ok' ? 'is-issue' : ''}">
        <time class="log__time">${fmtWhen(l.ts)}</time>
        <span class="log__what">${ACTION_LABEL[l.action] || l.action}${l.result !== 'ok' ? html` <em>denegada: ${RESULT_LABEL[l.result] || l.result}</em>` : ''}</span>
        <span class="log__plate">${l.plate ? formatPlate(l.plate) : '—'}</span>
        <span class="log__who">${l.nombre || ''}</span>
        <span class="log__meta">${zoneName(l.scanZona || l.zona)}${l.durationMin !== null && l.durationMin !== undefined && !Number.isNaN(l.durationMin) && (l.action === 'exit' || l.action === 'manual_exit') ? `, ${fmtDuration(l.durationMin)}` : ''}${l.offline ? ', sin conexión' : ''}</span>
      </li>`)).join('') : String(html`<li class="empty-line">${filters.onlyIssues ? 'No hay incidencias recientes.' : 'Todavía no hay movimientos.'}</li>`);
  }

  // ── Ficha ──
  function openUser(id) {
    const u = data.users.find(x => x.id === id);
    if (!u) return;
    const pass = { ...u, zonaName: zoneName(u.zona), eventName: data.config.eventName };
    openDialog(html`
      <div class="sheet">
        <div class="sheet__top">
          ${plate(u.plate, 'lg')}
          <span class="pill ${u.status === 'in' ? 'pill--in' : ''}">${u.status === 'in' ? `Dentro desde ${fmtWhen(u.entryTs)}` : 'Fuera'}</span>
        </div>
        <h2 class="dialog__title">${u.nombre} ${u.apellidos}</h2>
        <div class="sheet__body">
          <dl class="facts">
            <div><dt>Zona</dt><dd>${zoneName(u.zona)}</dd></div>
            <div><dt>Vehículo</dt><dd>${[u.marca, u.modelo].filter(Boolean).join(' ') || '—'}</dd></div>
            <div><dt>DNI o NIE</dt><dd>${u.dni || '—'}</dd></div>
            <div><dt>Email</dt><dd>${u.email || '—'}</dd></div>
            <div><dt>Móvil</dt><dd>${u.telefono || '—'}</dd></div>
            <div><dt>Nacimiento</dt><dd>${u.nacimiento || '—'}</dd></div>
            <div><dt>Registrado</dt><dd>${u.registeredAt ? fmtWhen(u.registeredAt) : '—'}</dd></div>
            <div><dt>Última salida</dt><dd>${u.lastExitTs ? fmtWhen(u.lastExitTs) : '—'}</dd></div>
          </dl>
          <div class="sheet__qr">${raw(qrSvg(qrPayload(u.token)))}</div>
        </div>
        <div class="dialog__actions dialog__actions--wrap">
          <button class="btn btn--primary" data-act="pdf" type="button">${raw(icon.download)} PDF del pase</button>
          ${u.status === 'in' ? html`<button class="btn btn--ghost" data-act="exit" type="button">Registrar salida manual</button>` : ''}
          <button class="btn btn--ghost" data-act="revoke" type="button">Renovar QR</button>
          <button class="btn btn--danger-ghost" data-act="delete" type="button">Borrar datos</button>
        </div>
      </div>`, { wide: true });

    $('#dialog-body').onclick = async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'pdf') {
        setBusy(btn, true, 'Preparando');
        try { await downloadPassPdf(pass); } catch { toast('No se pudo crear el PDF', 'error'); }
        setBusy(btn, false);
        return;
      }
      const ask = {
        exit: { title: 'Registrar salida manual', body: `${formatPlate(u.plate)} quedará como fuera del aparcamiento.`, confirm: 'Registrar salida' },
        revoke: { title: 'Renovar el QR', body: 'El QR actual dejará de funcionar y se generará uno nuevo. Úsalo si el pase se ha perdido o compartido. Tendrás que enviar el nuevo PDF al titular.', confirm: 'Renovar QR' },
        delete: { title: 'Borrar los datos', body: `Se eliminarán los datos personales de ${u.nombre} ${u.apellidos} y su pase dejará de funcionar. No se puede deshacer.`, confirm: 'Borrar datos', danger: true },
      }[act];
      if (!(await confirmDialog(ask))) { openUser(id); return; }
      try {
        if (act === 'exit') { await api('forceExit', { userId: id }); toast('Salida registrada', 'ok'); }
        if (act === 'revoke') {
          const nu = await api('revoke', { userId: id });
          toast('QR renovado. Descarga el PDF nuevo para el titular.', 'ok', 5000);
          Object.assign(u, nu);
        }
        if (act === 'delete') { await api('deleteUser', { userId: id }); toast('Datos borrados', 'ok'); }
        await load();
        if (act === 'revoke') openUser(id);
      } catch (err) {
        toast(err.message, 'error', 5000);
      }
    };
  }

  // ── Exportar ──
  function exportUsers() {
    if (!data) return;
    const rows = data.users.map(u => [formatPlate(u.plate), u.nombre, u.apellidos, u.dni, u.email, u.telefono, u.nacimiento, u.marca, u.modelo, zoneName(u.zona), u.status === 'in' ? 'Dentro' : 'Fuera', u.entryTs ? fmtWhen(u.entryTs) : '', u.registeredAt ? fmtWhen(u.registeredAt) : '']);
    download(`usuarios_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Matrícula', 'Nombre', 'Apellidos', 'DNI/NIE', 'Email', 'Móvil', 'Nacimiento', 'Marca', 'Modelo', 'Zona', 'Estado', 'Entrada', 'Registrado'], rows));
  }
  async function exportLogs(e) {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Descargando');
    try {
      const { logs } = await api('allLogs', {}, { timeout: 40000 });
      const rows = logs.map(l => [new Date(l.ts).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }), ACTION_LABEL[l.action] || l.action, l.result === 'ok' ? 'Correcto' : 'Denegado: ' + (RESULT_LABEL[l.result] || l.result), formatPlate(l.plate), l.nombre, zoneName(l.scanZona || l.zona), l.durationMin ?? '', l.offline ? 'Sí' : 'No', l.role, l.detail]);
      download(`movimientos_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Fecha', 'Acción', 'Resultado', 'Matrícula', 'Titular', 'Zona', 'Minutos', 'Sin conexión', 'Rol', 'Detalle'], rows));
    } catch (err) { toast(err.message, 'error'); }
    setBusy(btn, false);
  }

  // ── Eventos ──
  $('#reload', root).onclick = () => load(true);
  $('#csv-users', root).onclick = exportUsers;
  $('#csv-logs', root).onclick = exportLogs;
  $('#q', root).addEventListener('input', debounce(e => { filters.q = e.target.value; if (data) renderUsers(); }, 150));
  $('#fz', root).onchange = e => { filters.zona = e.target.value; if (data) renderUsers(); };
  $('#fs', root).onchange = e => { filters.status = e.target.value; if (data) renderUsers(); };
  $('#issues', root).onchange = e => { filters.onlyIssues = e.target.checked; if (data) renderLog(); };
  $('#users', root).addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openUser(b.dataset.open); });

  const tick = setInterval(() => {
    if (document.hidden || $('#dialog').open) { if (data) $('#updated', root).textContent = `Actualizado ${ago(loadedAt)}`; return; }
    load();
  }, 30000);
  await load();
  return () => { clearInterval(tick); closeDialog(); };
}
