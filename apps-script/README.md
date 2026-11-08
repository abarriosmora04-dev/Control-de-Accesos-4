# Servidor (Google Apps Script)

El servidor se publica solo desde GitHub. Cada cambio en `main` hace esto:

1. Sube `Code.gs` al proyecto de Apps Script y publica una versión nueva con la misma URL.
2. Comprueba que el servidor responde.
3. Solo entonces publica la web. Si el servidor falla, la web anterior sigue funcionando.

En la primera petición tras el despliegue, el servidor se prepara solo:
- Crea las hojas **Usuarios** y **Movimientos**.
- Copia los usuarios y movimientos antiguos. Las hojas antiguas no se tocan; si alguna se llamaba igual, se renombra a «(antigua)».
- Los QR que la gente ya tiene siguen valiendo mientras `allowLegacyQr` sea `true`.

## Configuración única (unos 10 minutos, desde un ordenador)

1. **Activa la API de Apps Script.** En [script.google.com/home/usersettings](https://script.google.com/home/usersettings), activa la «API de Google Apps Script».
2. **Conecta tu cuenta de Google.** En una terminal con Node.js instalado:
   ```
   npx @google/clasp@2.4.2 login
   ```
   Se abre Google: entra con la cuenta dueña de «Controlpark DB» y pulsa *Permitir*. Esto crea el archivo `.clasprc.json` en tu carpeta de usuario (`C:\Users\TU_USUARIO\.clasprc.json` en Windows, `~/.clasprc.json` en Mac).
3. **Guarda tres secretos en GitHub.** En el repositorio, ve a *Settings → Secrets and variables → Actions → New repository secret*:
   - `CLASPRC_JSON`: el contenido completo de `.clasprc.json`. Es una credencial de tu cuenta: pégala solo ahí, nunca en un chat.
   - `ADMIN_PASSWORD`: la contraseña del panel (mínimo 8 caracteres).
   - `OPERATOR_PASSWORD`: la contraseña del escáner, distinta de la anterior.
4. **Anota el ID del script.** Abre «Controlpark DB», ve a *Extensiones → Apps Script → Configuración del proyecto* (el engranaje) y copia el «ID de secuencia de comandos». Ese ID va en `apps-script/project.json`.

Para cambiar una contraseña, edita su secreto en GitHub y vuelve a lanzar el despliegue: *Actions → Desplegar → Run workflow*.

## Ajustes del evento

Están en `CONFIG`, al principio de `Code.gs`:
- nombre del evento;
- zonas y su aforo (`capacity`);
- edad mínima y campos obligatorios;
- si se deniegan entradas con la zona llena (`enforceCapacity`);
- si se aceptan los QR antiguos (`allowLegacyQr`).

**Retira los QR antiguos.** Cuando todos tengan el pase nuevo, pon `allowLegacyQr: false`. Los QR antiguos solo llevan la matrícula y cualquiera podría falsificarlos.

**Vaciar los datos para un evento nuevo.** En el panel, «Vaciar todos los datos» (pide escribir BORRAR). También se puede desde aquí: cambia el valor de `resetId` en `CONFIG` y el siguiente despliegue lo vacía todo una sola vez. Solo se borran las hojas de la app; otras hojas que añadas a mano no se tocan.

**Cerrar todas las sesiones abiertas.** Borra la propiedad del script `SESSION_SECRET`; se regenera sola.

## Acciones de la API

Todas por `POST` con un cuerpo JSON: `{ "action": "...", ... }`.

| Acceso | Acciones |
|---|---|
| Público | `config`, `register`, `pass` (por token), `recover` (DNI + email), `login` |
| Operador o admin | `snapshot`, `scan`, `scanBatch` (sincronización sin conexión) |
| Solo admin | `dashboard`, `forceExit`, `revoke`, `deleteUser`, `allLogs` |
