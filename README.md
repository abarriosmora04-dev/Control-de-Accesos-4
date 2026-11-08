# ControlPark · Control de accesos

App web (PWA) para registrar vehículos, dar a cada persona un pase con QR y controlar entradas y salidas de aparcamientos de eventos. El backend es Google Sheets con Apps Script.

## Partes

- **Registro público** (`#registro`). La persona elige zona, rellena sus datos y recibe su pase. El pase queda guardado en el móvil, se descarga en PDF y se recupera con DNI + email (`#recuperar`).
- **Escáner** (`#escaner`, contraseña de operador):
  - Usa la cámara trasera, con linterna, y permite escribir la matrícula a mano.
  - Muestra el resultado a pantalla completa con sonido y vibración.
  - Funciona sin conexión: valida contra una copia local y envía los movimientos al volver la red.
- **Panel** (`#panel`, contraseña de administración):
  - Ocupación por zona, actividad por horas, búsqueda y ficha de cada vehículo.
  - Salida manual, renovación del QR, borrado de datos (RGPD) y exportación a CSV.

## Estructura

```
index.html            Estructura de la página
css/app.css           Estilos
js/app.js             Arranque y navegación
js/views/*.js         Pantallas: registro, pase, recuperar, acceso, escáner, panel
js/api.js             Llamadas al backend y sesión
js/offline.js         Copia local y cola de movimientos sin conexión
js/camera.js          Lectura de QR (detector nativo o jsQR)
js/pdf.js, js/qr.js   Pase en PDF y generación del QR
js/config.js          URL del backend
vendor/               Librerías servidas en local (funcionan sin conexión)
sw.js, manifest.json  PWA
apps-script/          Backend (Code.gs) y guía de despliegue
```

## Despliegue

- **Web:** GitHub Pages despliega automáticamente cada cambio en `main`. Todas las rutas son relativas, así que también funciona en una subcarpeta de controlpark.es.
- **Backend:** sigue [`apps-script/README.md`](apps-script/README.md).

## Cambiar de evento

Edita `CONFIG` en `apps-script/Code.gs` (nombre, zonas, aforo, edad mínima) y publica una nueva versión del script. La app lee la configuración del servidor: no hace falta tocar la web.
