// Sonido y vibración para que el operario sepa el resultado sin mirar la pantalla.
let ctx = null;

export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}

/** kind: 'ok' | 'warn' | 'deny' */
export function signal(kind) {
  try {
    if (kind === 'ok') { tone(880, 0, 0.12); tone(1320, 0.12, 0.16); navigator.vibrate?.(80); }
    else if (kind === 'warn') { tone(660, 0, 0.18, 'triangle'); tone(660, 0.24, 0.18, 'triangle'); navigator.vibrate?.([120, 80, 120]); }
    else { tone(220, 0, 0.45, 'square', 0.12); navigator.vibrate?.([250, 100, 250]); }
  } catch { /* sin audio ni vibración */ }
}
