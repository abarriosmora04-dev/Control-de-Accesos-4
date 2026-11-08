import { api } from '../api.js';
import { html, $, store, normPlate } from '../util.js';
import { toast, setBusy } from '../ui.js';

export async function mount(root, { go }) {
  root.innerHTML = html`
  <section class="page page--narrow">
    <header class="intro">
      <h1 class="intro__title">Recupera tu pase</h1>
      <p class="intro__lead">Escribe el DNI o NIE y el email que usaste al registrarte.</p>
    </header>
    <form id="rec" class="form" novalidate>
      <div class="field">
        <label class="field__label" for="r-dni">DNI o NIE</label>
        <input class="input" id="r-dni" name="dni" required autocapitalize="characters" maxlength="10" spellcheck="false">
      </div>
      <div class="field">
        <label class="field__label" for="r-email">Email</label>
        <input class="input" id="r-email" name="email" type="email" required autocomplete="email" inputmode="email">
      </div>
      <p class="field__error" id="r-error" aria-live="polite"></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit" id="r-submit">Recuperar mi pase</button>
      <p class="form__foot">¿Aún no tienes pase? <a href="#registro">Regístrate</a></p>
    </form>
  </section>`;

  const form = $('#rec', root);
  form.dni.addEventListener('input', () => { form.dni.value = normPlate(form.dni.value); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#r-error', root);
    err.textContent = '';
    if (!form.dni.value || !form.email.value.trim()) { err.textContent = 'Escribe tu DNI o NIE y tu email'; return; }
    const btn = $('#r-submit', root);
    setBusy(btn, true, 'Buscando');
    try {
      const pass = await api('recover', { dni: form.dni.value, email: form.email.value.trim() });
      store.set('cp_pass', pass);
      toast('Pase recuperado', 'ok');
      go('pase/' + pass.token);
    } catch (e2) {
      setBusy(btn, false);
      err.textContent = e2.network ? 'No hay conexión. Revisa tu internet y vuelve a intentarlo.' : e2.message;
    }
  });
  form.dni.focus();
}
