#!/usr/bin/env node
/**
 * verify:permisos — la matriz de permisos ejercida POR HTTP, contra la app real.
 *
 * ## Qué agrega sobre los tests unitarios
 *
 * `route-coverage.test.ts` prueba la MATRIZ: que las capacidades cubran las 480 rutas y que cada
 * rol tenga lo que tiene que tener. Pero eso no dice nada sobre si el interceptor está cableado.
 * Un `PermissionsInterceptor` sacado del array de providers, o registrado ANTES que el de auth,
 * deja los 14 tests en verde y la API abierta de par en par: llegaría sin `requestContext` y
 * ninguna prueba funcional lo notaría, porque la app responde igual.
 *
 * Es la misma brecha que `verify:pg` cierra para la RLS —el motor puede estar bien y la app no
 * usarlo— y se cierra de la misma forma: levantando el binario y golpeándolo por HTTP.
 *
 * ## Por qué firma sus propios tokens
 *
 * Para aislar el efecto del ROL y nada más. Se emiten tokens del MISMO usuario y el MISMO tenant
 * cambiando solo el claim `role`: si algo cambia entre dos respuestas, fue el rol. Crear seis
 * usuarios reales metería en el medio seis altas, seis asignaciones y la posibilidad de que la
 * diferencia venga de los datos y no del permiso.
 *
 * Usa la clave de DESARROLLO a propósito (ver `jwt-secret.ts`): este script solo tiene sentido
 * contra una instancia local. En producción esa clave no arranca.
 *
 * Uso: npm run verify:permisos   (no requiere Docker; corre sobre PGlite)
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = 3058;
const API = `http://127.0.0.1:${PORT}/v1`;
const SECRET = 'cowinance-dev-secret';
const ISSUER = 'cowinance-dev';

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

/**
 * Casos: [rol, método, ruta, esperado]. `403` = la matriz TIENE que denegarlo; `'ok'` = cualquier
 * cosa menos 403 (200, 201, 404 de un id inexistente: lo que se prueba es la puerta, no el dato).
 *
 * No es la matriz entera —eso lo cubre el test unitario— sino sus FRONTERAS: los cortes que, si se
 * rompieran, serían una fuga y no una molestia.
 */
const CASOS = [
  ['owner', 'GET', '/finance/accounts', 'ok'],
  ['owner', 'GET', '/animals?limit=1', 'ok'],
  ['owner', 'GET', '/billing/subscription', 'ok'],

  // El veterinario ve el hato y manda en lo clínico, pero no ve un solo número de plata.
  ['veterinarian', 'GET', '/animals?limit=1', 'ok'],
  ['veterinarian', 'GET', '/health/withdrawals', 'ok'],
  ['veterinarian', 'GET', '/inventory/items', 'ok'],
  ['veterinarian', 'GET', '/health/costs', 403],
  ['veterinarian', 'GET', '/finance/accounts', 403],
  ['veterinarian', 'GET', '/commerce/sales', 403],
  ['veterinarian', 'GET', '/hr/payroll', 403],

  // El capataz APLICA lo sanitario pero no lo INDICA; carga el parte pero no ve sueldos.
  ['foreman', 'GET', '/animals?limit=1', 'ok'],
  ['foreman', 'GET', '/health/withdrawals', 'ok'],
  ['foreman', 'POST', '/clinical-cases', 403],
  ['foreman', 'GET', '/hr/work-logs', 'ok'],
  ['foreman', 'GET', '/hr/payroll', 403],
  ['foreman', 'GET', '/hr/employees', 403],
  ['foreman', 'GET', '/finance/accounts', 403],

  // El operario captura; no consulta.
  ['worker', 'GET', '/animals?limit=1', 'ok'],
  ['worker', 'GET', '/tasks', 'ok'],
  ['worker', 'GET', '/reports/herd-inventory', 403],
  ['worker', 'GET', '/finance/accounts', 403],
  ['worker', 'GET', '/genetics/cryo/tanks', 403],

  // El contador manda en la plata y no entra a la ficha de un animal.
  ['accountant', 'GET', '/finance/accounts', 'ok'],
  ['accountant', 'GET', '/tax/series', 'ok'],
  ['accountant', 'GET', '/commerce/sales', 'ok'],
  ['accountant', 'GET', '/animals?limit=1', 403],
  ['accountant', 'GET', '/health/withdrawals', 403],

  // La suscripción es del dueño, no del administrador.
  ['admin', 'GET', '/finance/accounts', 'ok'],
  ['admin', 'GET', '/billing/subscription', 403],

  // Denegar por defecto: un rol que no está en la matriz no puede NADA.
  ['intruso', 'GET', '/animals?limit=1', 403],
];

console.log('\n\x1b[1m══ verify:permisos — la matriz por HTTP\x1b[0m\n');

const tmp = mkdtempSync(join(tmpdir(), 'permisos-'));
const proc = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], {
  cwd: tmp, // PGlite escribe su base en el cwd: cada corrida arranca limpia
  env: { ...process.env, SEED_DEMO: 'on', PORT: String(PORT), EMAIL_PROVIDER: 'log', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
proc.stdout.on('data', (d) => (bootLog += d));
proc.stderr.on('data', (d) => (bootLog += d));

const stop = () => {
  try {
    proc.kill('SIGTERM');
  } catch {}
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
};
process.on('exit', stop);

try {
  let up = false;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`${API}/animals`);
      if (r.status === 401 || r.status === 200) {
        up = true;
        break;
      }
    } catch {
      /* todavía no */
    }
  }
  if (!up) {
    bad('la app no levantó', bootLog.slice(-800));
    process.exit(1);
  }

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cowinance@gmail.com', password: 'cowinance' }),
  });
  if (!login.ok) {
    bad(`no se pudo iniciar sesión (${login.status})`, bootLog.slice(-400));
    process.exit(1);
  }
  const base = jwt.decode((await login.json()).access_token);
  ok(`sesión base: rol=${base.role}`);

  const tokenPara = (role) =>
    jwt.sign({ sub: base.sub, ten: base.ten, role, email: base.email, name: base.name, typ: 'access' }, SECRET, {
      issuer: ISSUER,
      expiresIn: '10m',
    });

  console.log('');
  for (const [role, method, path, esperado] of CASOS) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokenPara(role)}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const etiqueta = `${role.padEnd(13)} ${method.padEnd(5)} ${path}`;
    if (esperado === 403) {
      r.status === 403 ? ok(`${etiqueta} → 403 denegado`) : bad(etiqueta, `devolvió ${r.status}; la matriz lo deniega`);
    } else {
      r.status !== 403 ? ok(`${etiqueta} → ${r.status}`) : bad(etiqueta, 'devolvió 403; la matriz lo permite');
    }
  }
} finally {
  stop();
}

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1m✓ La matriz se aplica de verdad\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m✗ ${failures} caso(s) no coinciden con la matriz\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
