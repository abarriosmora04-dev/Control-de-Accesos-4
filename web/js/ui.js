// Componentes de interfaz compartidos.
import { html, raw, esc, formatPlate, $ } from './util.js';

export const icon = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  in: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6.5 10.5L12 16l5.5-5.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V8M6.5 13.5L12 8l5.5 5.5M5 4h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  torch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.5 5v12a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 9.5 20V8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 7.5L12 4l4 3.5M6 11v8.5h12V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  offline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M14.5 10.3A10 10 0 0 1 19 12.5M2 9a14 14 0 0 1 4.2-2.6M12 20h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

/** Matrícula con la banda azul de la UE. size: 'lg' | 'md' | 'sm' */
export function plate(p, size = 'md') {
  return html`<span class="plate plate--${size}" aria-label="Matrícula ${p}"><span class="plate__eu" aria-hidden="true"><span class="plate__stars"></span><b>E</b></span><span class="plate__num">${formatPlate(p)}</span></span>`;
}

// ── Avisos breves ──
let toastTimer;
export function toast(msg, kind = 'info', ms = 3200) {
  const el = $('#toast');
  el.className = 'toast toast--' + kind + ' is-on';
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

// ── Diálogo modal (usa <dialog> nativo: foco, Esc y accesibilidad incluidos) ──
export function openDialog(content, { onClose, wide = false } = {}) {
  const dlg = $('#dialog');
  dlg.classList.toggle('dialog--wide', wide);
  $('#dialog-body').innerHTML = String(content);
  $('#dialog-body').onclick = null;
  dlg.onclose = () => { $('#dialog-body').innerHTML = ''; onClose?.(); };
  if (!dlg.open) dlg.showModal();
  return dlg;
}
export function closeDialog() { const d = $('#dialog'); if (d.open) d.close(); }

/** Confirmación con botones propios (en vez de confirm()). Devuelve una promesa. */
export function confirmDialog({ title, body, confirm = 'Confirmar', danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    openDialog(html`
      <h2 class="dialog__title">${title}</h2>
      <p class="dialog__text">${body}</p>
      <div class="dialog__actions">
        <button class="btn btn--ghost" data-a="no" type="button">Cancelar</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-a="yes" type="button">${confirm}</button>
      </div>`, { onClose: () => resolve(answer) });
    $('#dialog-body').onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      answer = a === 'yes';
      closeDialog();
    };
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label || 'Un momento')}`;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export { raw };
