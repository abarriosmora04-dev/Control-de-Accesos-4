import { api } from '../api.js';
import { html, raw, $, $$, store, normPlate, isValidPlate, isValidDni, ageFrom, formatPlate } from '../util.js';
import { toast, setBusy, plate } from '../ui.js';

const field = ({ name, label, type = 'text', required, hint, attrs = '', wide }) => html`
  <div class="field ${wide ? 'field--wide' : ''}">
    <label class="field__label" for="f-${name}">${label}${required ? '' : html` <span class="field__opt">(opcional)</span>`}</label>
    <input class="input" id="f-${name}" name="${name}" type="${type}" ${required ? html`required` : ''} ${raw(attrs)} aria-describedby="e-${name}${hint ? ` h-${name}` : ''}">
    ${hint ? html`<p class="field__hint" id="h-${name}">${hint}</p>` : ''}
    <p class="field__error" id="e-${name}" aria-live="polite"></p>
  </div>`;

export async function mount(root, { config, go }) {
  const saved = store.get('cp_pass');
  const draft = store.get('cp_draft', {});
  const zones = config.zones || [];

  root.innerHTML = html`
  <section class="page page--narrow">
    <header class="intro">
      <h1 class="intro__title">Registra tu vehículo</h1>
      <p class="intro__lead">Te damos un pase con código QR para entrar y salir del aparcamiento. Solo tienes que enseñarlo en la puerta.</p>
    </header>

    ${saved ? html`
      <a class="notice notice--link" href="#pase">
        ${plate(saved.plate, 'sm')}
        <span>Ya tienes un pase guardado en este móvil. <strong>Abrir mi pase</strong></span>
      </a>` : ''}

    <form id="reg" class="form" novalidate autocomplete="on">
      <fieldset class="group">
        <legend class="group__title">¿Dónde vas a aparcar?</legend>
        <div class="zones" role="radiogroup">
          ${zones.map(z => html`
            <label class="zone">
              <input type="radio" name="zona" value="${z.id}" required>
              <span class="zone__name">${z.name}</span>
              <span class="zone__check" aria-hidden="true"></span>
            </label>`)}
        </div>
        <p class="field__error" id="e-zona" aria-live="polite"></p>
      </fieldset>

      <fieldset class="group">
        <legend class="group__title">Tus datos</legend>
        <div class="grid">
          ${field({ name: 'nombre', label: 'Nombre', required: true, attrs: 'autocomplete="given-name" maxlength="60"' })}
          ${field({ name: 'apellidos', label: 'Apellidos', required: true, attrs: 'autocomplete="family-name" maxlength="80"' })}
          ${field({ name: 'dni', label: 'DNI o NIE', required: config.requireDni, attrs: 'autocapitalize="characters" maxlength="10" inputmode="text" spellcheck="false"', hint: 'Sirve para recuperar tu pase si lo pierdes.' })}
          ${field({ name: 'nacimiento', label: 'Fecha de nacimiento', type: 'date', required: config.requireBirthDate, attrs: 'autocomplete="bday" min="1900-01-01"' })}
          ${field({ name: 'email', label: 'Email', type: 'email', required: config.requireEmail, attrs: 'autocomplete="email" inputmode="email" maxlength="120"', wide: true })}
          ${field({ name: 'telefono', label: 'Móvil', type: 'tel', required: config.requirePhone, attrs: 'autocomplete="tel" inputmode="tel" maxlength="16"', wide: true })}
        </div>
      </fieldset>

      <fieldset class="group">
        <legend class="group__title">Tu vehículo</legend>
        <div class="field field--wide">
          <label class="field__label" for="f-plate">Matrícula</label>
          <div class="plate-input">
            <span class="plate__eu" aria-hidden="true"><span class="plate__stars"></span><b>E</b></span>
            <input class="plate-input__field" id="f-plate" name="plate" required autocapitalize="characters" spellcheck="false" autocomplete="off" maxlength="12" placeholder="1234 BCD" aria-describedby="e-plate">
          </div>
          <label class="check check--inline"><input type="checkbox" name="foreignPlate" id="f-foreign"> Es una matrícula extranjera</label>
          <p class="field__error" id="e-plate" aria-live="polite"></p>
        </div>
        <div class="grid">
          ${field({ name: 'marca', label: 'Marca', attrs: 'maxlength="40" placeholder="Seat"' })}
          ${field({ name: 'modelo', label: 'Modelo', attrs: 'maxlength="40" placeholder="Ibiza"' })}
        </div>
      </fieldset>

      <div class="hp" aria-hidden="true"><label>Web <input name="website" tabindex="-1" autocomplete="off"></label></div>

      <div class="field">
        <label class="check">
          <input type="checkbox" name="consent" id="f-consent" aria-describedby="e-consent">
          <span>Acepto que Controlpark Eventos S.L. use estos datos solo para gestionar el acceso a este aparcamiento. Puedes pedir que los borremos escribiendo a ${config.privacyContact || 'info@controlpark.es'}.</span>
        </label>
        <p class="field__error" id="e-consent" aria-live="polite"></p>
      </div>

      <button class="btn btn--primary btn--block btn--lg" id="submit" type="submit">Crear mi pase</button>
      <p class="form__foot">¿Ya te registraste? <a href="#recuperar">Recupera tu pase</a></p>
    </form>
  </section>`;

  const form = $('#reg', root);
  const plateInput = $('#f-plate', root);

  // Restaurar borrador (sin datos sensibles más allá de lo que el usuario escribió en este móvil)
  Object.entries(draft).forEach(([k, v]) => {
    const el = form.elements[k];
    if (!el) return;
    if (el instanceof RadioNodeList) $$(`input[name="${k}"]`, form).forEach(r => { r.checked = r.value === v; });
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });

  plateInput.addEventListener('input', () => {
    const pos = plateInput.value.length;
    plateInput.value = plateInput.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
    plateInput.setSelectionRange(pos, pos);
  });
  plateInput.addEventListener('blur', () => { if (!form.foreignPlate.checked) plateInput.value = formatPlate(plateInput.value); });
  form.dni.addEventListener('input', () => { form.dni.value = form.dni.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  const saveDraft = () => {
    const d = Object.fromEntries(['zona', 'nombre', 'apellidos', 'marca', 'modelo', 'email', 'telefono'].map(k => [k, form.elements[k]?.value || '']));
    store.set('cp_draft', d);
  };
  form.addEventListener('change', saveDraft);

  form.addEventListener('blur', e => { if (e.target.name && e.target.dataset.touched !== undefined) validate(form, config, e.target.name); }, true);
  form.addEventListener('input', e => { if (e.target.name) { e.target.dataset.touched = ''; clearError(form, e.target.name); } });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errors = validate(form, config);
    if (Object.keys(errors).length) {
      focusFirstError(form, errors);
      return;
    }
    const btn = $('#submit', root);
    setBusy(btn, true, 'Creando tu pase');
    try {
      const user = {
        zona: form.zona.value,
        nombre: form.nombre.value.trim(), apellidos: form.apellidos.value.trim(),
        dni: form.dni.value, nacimiento: form.nacimiento.value,
        email: form.email.value.trim(), telefono: form.telefono.value.trim(),
        marca: form.marca.value.trim(), modelo: form.modelo.value.trim(),
        plate: normPlate(plateInput.value), foreignPlate: form.foreignPlate.checked,
        consent: form.consent.checked,
      };
      const pass = await api('register', { user, website: form.website.value });
      store.set('cp_pass', pass);
      store.del('cp_draft');
      toast('Pase creado', 'ok');
      go('pase/' + pass.token);
    } catch (err) {
      setBusy(btn, false);
      if (err.code === 'validation' && err.extra) {
        Object.entries(err.extra).forEach(([k, msg]) => showError(form, k, msg));
        focusFirstError(form, err.extra);
      } else if (err.code === 'dni_exists') {
        showError(form, 'dni', err.message, true);
        focusFirstError(form, { dni: 1 });
      } else if (err.code === 'plate_exists') {
        showError(form, 'plate', err.message, true);
        focusFirstError(form, { plate: 1 });
      } else if (err.network) {
        toast('No hay conexión. Revisa tu internet y vuelve a pulsar «Crear mi pase».', 'error', 5000);
      } else {
        toast(err.message, 'error', 5000);
      }
    }
  });
}

function validate(form, config, only) {
  const v = n => (form.elements[n]?.value || '').trim();
  const errors = {};
  const check = (name, msg) => { if ((!only || only === name) && msg) errors[name] = msg; };
  check('zona', !form.zona.value && 'Elige la zona donde vas a aparcar');
  check('nombre', !v('nombre') ? 'Escribe tu nombre' : v('nombre').length < 2 && 'El nombre es demasiado corto');
  check('apellidos', !v('apellidos') ? 'Escribe tus apellidos' : v('apellidos').length < 2 && 'Los apellidos son demasiado cortos');
  const dni = v('dni');
  check('dni', !dni ? config.requireDni && 'Escribe tu DNI o NIE' : !isValidDni(dni) && 'Revisa el número y la letra del DNI o NIE');
  const birth = v('nacimiento');
  if (!birth) check('nacimiento', config.requireBirthDate && 'Indica tu fecha de nacimiento');
  else {
    const age = ageFrom(birth);
    check('nacimiento', age === null || age > 110 ? 'Fecha no válida' : config.minAge && age < config.minAge && `Tienes que tener al menos ${config.minAge} años`);
  }
  const email = v('email');
  check('email', !email ? config.requireEmail && 'Escribe tu email' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && 'Revisa el email');
  const tel = v('telefono').replace(/[\s.-]/g, '');
  check('telefono', !tel ? config.requirePhone && 'Escribe tu móvil' : !/^\+?[0-9]{9,15}$/.test(tel) && 'Revisa el número de móvil');
  const p = normPlate(v('plate'));
  check('plate', !p ? 'Escribe la matrícula' : !isValidPlate(p, form.foreignPlate.checked) && (form.foreignPlate.checked ? 'Revisa la matrícula' : 'Revisa la matrícula. Formato: 1234 BCD. Si es extranjera, marca la casilla.'));
  check('consent', !form.consent.checked && 'Necesitamos tu permiso para guardar los datos');

  const names = only ? [only] : ['zona', 'nombre', 'apellidos', 'dni', 'nacimiento', 'email', 'telefono', 'plate', 'consent'];
  names.forEach(n => (errors[n] ? showError(form, n, errors[n]) : clearError(form, n)));
  return errors;
}

function showError(form, name, msg, withRecover = false) {
  const el = form.querySelector('#e-' + name);
  if (!el) { toast(msg, 'error'); return; }
  el.innerHTML = String(html`${msg}${withRecover ? html` <a href="#recuperar">Recuperar mi pase</a>` : ''}`);
  form.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
  el.closest('.field, .group')?.classList.add('has-error');
}

function clearError(form, name) {
  const el = form.querySelector('#e-' + name);
  if (el) el.textContent = '';
  form.querySelector(`[name="${name}"]`)?.removeAttribute('aria-invalid');
  el?.closest('.field, .group')?.classList.remove('has-error');
}

function focusFirstError(form, errors) {
  const order = ['zona', 'nombre', 'apellidos', 'dni', 'nacimiento', 'email', 'telefono', 'plate', 'consent'];
  const first = order.find(n => errors[n]);
  const el = first && form.querySelector(`[name="${first}"]`);
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
