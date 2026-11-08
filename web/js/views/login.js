import { api, session } from '../api.js';
import { html, $ } from '../util.js';
import { toast, setBusy } from '../ui.js';

export async function mount(root, { go }) {
  root.innerHTML = html`
  <section class="page page--narrow">
    <header class="intro">
      <h1 class="intro__title">Acceso del personal</h1>
      <p class="intro__lead">Con la contraseña de operador puedes escanear pases. Con la de administración, además, ver el panel.</p>
    </header>
    <form id="login" class="form" novalidate>
      <div class="field">
        <label class="field__label" for="l-pw">Contraseña</label>
        <input class="input" id="l-pw" name="password" type="password" required autocomplete="current-password">
      </div>
      <p class="field__error" id="l-error" aria-live="polite"></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit" id="l-submit">Entrar</button>
    </form>
  </section>`;

  const form = $('#login', root);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#l-error', root);
    err.textContent = '';
    if (!form.password.value) { err.textContent = 'Escribe la contraseña'; return; }
    const btn = $('#l-submit', root);
    setBusy(btn, true, 'Comprobando');
    try {
      const s = await api('login', { password: form.password.value });
      session.set(s);
      toast(s.role === 'admin' ? 'Has entrado como administración' : 'Has entrado como operador', 'ok');
      go(s.role === 'admin' ? 'panel' : 'escaner');
    } catch (e2) {
      setBusy(btn, false);
      form.password.value = '';
      form.password.focus();
      err.textContent = e2.network ? 'No hay conexión. Para entrar la primera vez necesitas internet.' : e2.message;
    }
  });
  form.password.focus();
}
