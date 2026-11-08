// Prepara la carpeta que se sube a Google Apps Script con clasp.
// Uso: ADMIN_PASSWORD=... OPERATOR_PASSWORD=... node scripts/build-apps-script.mjs <carpeta-salida>
// Las contraseñas no se guardan nunca en claro: solo un hash SHA-256 con sal aleatoria.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const out = process.argv[2] || 'build/apps-script';
const src = 'apps-script';
const { scriptId } = JSON.parse(fs.readFileSync(path.join(src, 'project.json'), 'utf8'));
const fail = msg => { console.error('::error::' + msg); process.exit(1); };

if (!scriptId) fail('Falta el ID del script en apps-script/project.json.');
const admin = process.env.ADMIN_PASSWORD || '';
const operator = process.env.OPERATOR_PASSWORD || '';
if (admin.length < 8) fail('Falta el secret ADMIN_PASSWORD en GitHub (mínimo 8 caracteres).');
if (operator.length < 8) fail('Falta el secret OPERATOR_PASSWORD en GitHub (mínimo 8 caracteres).');
if (admin === operator) fail('ADMIN_PASSWORD y OPERATOR_PASSWORD deben ser distintas.');

const salt = crypto.randomBytes(16).toString('hex');
const hash = pw => crypto.createHash('sha256').update(salt + pw, 'utf8').digest('hex');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(src, 'Code.gs'), path.join(out, 'Code.js'));
fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(out, 'appsscript.json'));
fs.writeFileSync(path.join(out, 'Secrets.js'),
  `// Generado automáticamente por GitHub en cada despliegue. No editar.\nconst AUTH = ${JSON.stringify({ salt, admin: hash(admin), operator: hash(operator) })};\n`);
fs.writeFileSync(path.join(out, '.clasp.json'), JSON.stringify({ scriptId, rootDir: '.' }));
console.log('Listo para subir al script ' + scriptId);
