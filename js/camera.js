// Lectura de QR con la cámara. Usa el detector nativo del navegador cuando existe
// (Android/Chrome: más rápido y con menos batería) y jsQR como alternativa (iPhone).
import { loadScript } from './util.js';

const INTERVAL_MS = 110;
const MAX_W = 720;

export class Camera {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.paused = false;
    this.detector = null;
    this.canvas = document.createElement('canvas');
    this.ctx2d = null;
    this.last = 0;
    this.busy = false;
    this._loop = this._loop.bind(this);
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Este navegador no permite usar la cámara'), { name: 'NoCamera' });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    await this.video.play().catch(() => {});
    await this._initDetector();
    this.running = true;
    requestAnimationFrame(this._loop);
  }

  async _initDetector() {
    if (this.detector || this.ctx2d) return;
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) { this.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); return; }
      }
    } catch { /* usar jsQR */ }
    await loadScript('vendor/jsQR.js');
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async _loop(ts) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    if (this.paused || this.busy || ts - this.last < INTERVAL_MS || !this.video.videoWidth) return;
    this.last = ts;
    this.busy = true;
    try {
      const value = await this._detect();
      if (value) this.onCode(value);
    } catch { /* fotograma ilegible */ } finally {
      this.busy = false;
    }
  }

  async _detect() {
    if (this.detector) {
      const codes = await this.detector.detect(this.video);
      return codes[0]?.rawValue || null;
    }
    let w = this.video.videoWidth, h = this.video.videoHeight;
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx2d.drawImage(this.video, 0, 0, w, h);
    const img = this.ctx2d.getImageData(0, 0, w, h);
    const code = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return code?.data || null;
  }

  get track() { return this.stream?.getVideoTracks()[0] || null; }

  hasTorch() {
    try { return !!this.track?.getCapabilities?.().torch; } catch { return false; }
  }

  async setTorch(on) {
    try { await this.track.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch { return false; }
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
