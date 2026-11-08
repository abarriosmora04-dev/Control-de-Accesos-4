// Configuración del despliegue.
// API_URL: URL de la implementación web de Google Apps Script (termina en /exec).
// Si actualizas la implementación existente con «Nueva versión», la URL no cambia.
export const API_URL = 'https://script.google.com/macros/s/AKfycbw_3iXG9z1tCFZ9sRFSC6rwrprU6FQg4hj5xnwjvGouqkA2ail47zf1jHu_AZwzXnaI/exec';

export const APP_VERSION = '3.1.0';

// Configuración por defecto si el servidor no responde la primera vez (se sustituye por la del servidor).
export const DEFAULT_CONFIG = {
  eventName: 'ControlPark',
  zones: [
    { id: 'polideportivo', name: 'Polideportivo', capacity: 0 },
    { id: 'feria', name: 'Av. de la Feria', capacity: 0 },
  ],
  minAge: 18,
  requireBirthDate: true,
  requireDni: true,
  requireEmail: true,
  requirePhone: false,
  privacyContact: 'info@controlpark.es',
};
