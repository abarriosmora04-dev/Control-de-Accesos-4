# Backend en Google Apps Script

`Code.gs` sustituye por completo al script anterior. Ya no expone los datos personales: solo el personal con contraseña puede consultarlos.

## Despliegue (unos 10 minutos)

Hazlo fuera de un día de evento: entre el paso 6 y el 7 la web antigua deja de funcionar.

1. **Copia de seguridad.** Abre la hoja de Google Sheets que usa la app y haz *Archivo → Hacer una copia*.
2. **Abre el editor.** En la hoja original: *Extensiones → Apps Script*.
3. **Pega el código nuevo.** Borra todo el contenido de `Código.gs` y pega el de [`Code.gs`](Code.gs). Guarda.
4. **Revisa la configuración.** Al principio del archivo, en `CONFIG`: nombre del evento, zonas, aforo (`capacity`), edad mínima y `appUrl`.
5. **Ejecuta `setup`.** Elige la función `setup` en la barra superior y pulsa *Ejecutar*. Acepta los permisos.
   - Crea las hojas **Usuarios** y **Movimientos**.
   - Genera dos contraseñas y las muestra en el *Registro de ejecución*: una de **administración** (panel y escáner) y otra de **operador** (solo escáner).
   - Para cambiarlas: *Configuración del proyecto → Propiedades del script*, en `ADMIN_PASSWORD` y `OPERATOR_PASSWORD`.
6. **Migra los datos antiguos.** Ejecuta `migrarDatosAntiguos`.
   - Copia los usuarios y los movimientos de las hojas antiguas sin tocarlas.
   - Puedes ejecutarla varias veces: no duplica nada.
   - Los QR que la gente ya tiene siguen funcionando mientras `allowLegacyQr` sea `true`.
7. **Publica la nueva versión.** *Implementar → Gestionar implementaciones*, lápiz de la implementación actual, *Versión: Nueva versión*. Ejecutar como **yo** y acceso **cualquier usuario**. Pulsa *Implementar*. Así la URL no cambia.
8. **Fusiona el Pull Request** en GitHub. En 1–2 minutos la web nueva está en GitHub Pages.

Si el script no está dentro de la hoja (proyecto independiente), añade en *Propiedades del script* la propiedad `SPREADSHEET_ID` con el ID de la hoja.

Si creas una implementación nueva en vez de actualizar la existente, la URL cambia: cópiala en `js/config.js` (`API_URL`).

## Después del despliegue

- **Retira los QR antiguos.** Cuando todos tengan el pase nuevo, pon `allowLegacyQr: false`. Los QR antiguos solo llevan la matrícula y cualquiera podría falsificarlos.
- **Cerrar todas las sesiones abiertas.** Borra la propiedad `SESSION_SECRET` (se regenera sola). Hazlo, por ejemplo, si cambias una contraseña porque se ha filtrado.
- **Email con el pase.** Pon `sendEmailOnRegister: true` para que cada persona reciba un email con el enlace a su pase. Usa la cuota diaria de Gmail: unos 100 al día en cuentas gratuitas y 1.500 en Workspace.
- **Aforo.** Con `capacity` en cada zona, el panel muestra la ocupación. Con `enforceCapacity: true`, además, el escáner deniega entradas cuando la zona está llena.

## Acciones de la API

Todas por `POST` con un cuerpo JSON: `{ "action": "...", ... }`.

| Acceso | Acciones |
|---|---|
| Público | `config`, `register`, `pass` (por token), `recover` (DNI + email), `login` |
| Operador o admin | `snapshot`, `scan`, `scanBatch` (sincronización sin conexión) |
| Solo admin | `dashboard`, `forceExit`, `revoke`, `deleteUser`, `allLogs` |
