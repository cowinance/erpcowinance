#!/usr/bin/env node
/**
 * verify:backup — un backup que nunca se restauró no es un backup.
 *
 * Este script no comprueba que `pg_dump` corra sin error: eso no prueba nada. Comprueba el
 * procedimiento COMPLETO, incluida la parte que nadie ensaya hasta el día del incidente:
 *
 *   1. Levanta la app contra una base limpia → esquema canónico + migraciones + datos demo.
 *   2. Toma la huella de los datos (conteos por tabla + versiones de migración aplicadas).
 *   3. Respalda con `deploy/backup/backup.sh`.
 *   4. DESTRUYE la base entera. De verdad: DROP DATABASE.
 *   5. Restaura con `deploy/backup/restore.sh`.
 *   6. La huella tiene que coincidir EXACTO.
 *   7. Arranca la app contra la base restaurada y hace login + lectura por HTTP. Esto es lo que
 *      separa "los bytes volvieron" de "el sistema funciona": secuencias, índices, vistas
 *      (v_weighings) y permisos también tienen que haber vuelto.
 *
 * Requiere `docker compose up -d db`. Los binarios de PostgreSQL se usan DENTRO del contenedor de
 * la base (`docker exec`): así la versión del cliente coincide siempre con la del servidor, que es
 * la causa más común de que un restore falle justo cuando hace falta.
 *
 * Uso: npm run verify:backup
 */
import { execFileSync, spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PG_URL = process.env.PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/postgres';
const DB = 'backup_verify';
const PORT = 3058;
const API = `http://127.0.0.1:${PORT}/v1`;
const DUMP_DIR = '/tmp/cowinance-backup-verify';

const dbUrl = (name) => {
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  return u.toString();
};
/** La URL vista DESDE el contenedor de la base: ahí Postgres es local. */
const dbUrlInContainer = (name) => {
  const u = new URL(PG_URL);
  u.hostname = '127.0.0.1';
  u.port = '5432';
  u.pathname = `/${name}`;
  return u.toString();
};

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

const sql = async (query, db = 'postgres') => {
  const c = new pg.Client({ connectionString: dbUrl(db) });
  await c.connect();
  try {
    return (await c.query(query)).rows;
  } finally {
    await c.end();
  }
};

/**
 * Contenedor de la base. Se busca por imagen para que sirva igual con el docker-compose local
 * (`cowinance-pg`) y con un service container de CI, que tiene un nombre generado.
 */
function findPgContainer() {
  if (process.env.PG_CONTAINER) return process.env.PG_CONTAINER;
  const out = execFileSync('docker', ['ps', '--format', '{{.ID}} {{.Image}}'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => /postgis|postgres/i.test(l.split(' ')[1] ?? ''));
  if (!line) throw new Error('No se encontró el contenedor de PostgreSQL. ¿Corriste `docker compose up -d db`?');
  return line.split(' ')[0];
}

const CONTAINER = findPgContainer();

/** Corre un script del repo DENTRO del contenedor de la base, por stdin. */
function runInContainer(scriptPath, args = [], env = {}) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const script = execFileSync('cat', [join(ROOT, scriptPath)], { encoding: 'utf8' });
  return execFileSync(
    'docker',
    ['exec', ...envArgs, '-i', CONTAINER, 'bash', '-s', '--', ...args],
    { input: script, encoding: 'utf8' },
  );
}

/** Arranca la API contra `DB` y espera a que responda. Devuelve una función para pararla. */
async function bootApi(seed) {
  const proc = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl(DB),
      SEED_DEMO: seed,
      PORT: String(PORT),
      EMAIL_PROVIDER: 'log',
      STORAGE_DRIVER: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const stop = () => {
    try {
      proc.kill('SIGTERM');
    } catch {}
  };
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if ((await fetch(`${API}/healthz`)).ok) return { stop, log: () => log };
    } catch {
      /* todavía no */
    }
  }
  stop();
  throw new Error(`La API no levantó contra ${DB}.\n${log.slice(-1200)}`);
}

/**
 * Huella de los datos. Se eligen las tablas que cubren las tres capas que un restore puede
 * romper por separado: identidad, datos de negocio y el registro de migraciones.
 */
const TABLAS = ['organizations', 'users', 'animals', 'animal_events', 'weighings', 'lots', 'schema_migrations'];
async function fingerprint() {
  const counts = {};
  for (const t of TABLAS) counts[t] = Number((await sql(`SELECT count(*)::int AS n FROM ${t}`, DB))[0].n);
  const versiones = (await sql(`SELECT version FROM schema_migrations ORDER BY version`, DB)).map((r) => r.version);
  return { counts, versiones };
}

console.log('\n\x1b[1m══ VERIFICACIÓN DE BACKUP Y RESTORE\x1b[0m\x1b[2m — el ensayo completo, no solo el dump\x1b[0m');

execFileSync('npm', ['run', 'build', '-w', '@cowinance/api'], { cwd: ROOT, stdio: 'pipe' });
execFileSync('docker', ['exec', CONTAINER, 'mkdir', '-p', DUMP_DIR]);

// ── 1. Base limpia con datos ──────────────────────────────────────────────────
await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await sql(`CREATE DATABASE ${DB}`);
let api = await bootApi('on');
const antes = await fingerprint();
api.stop();
ok(`base sembrada · ${antes.counts.animals} animales · ${antes.versiones.length} migraciones registradas`);

// ── 2. Backup ─────────────────────────────────────────────────────────────────
let dump;
try {
  const salida = runInContainer('deploy/backup/backup.sh', [], {
    DATABASE_ADMIN_URL: dbUrlInContainer(DB),
    BACKUP_DIR: DUMP_DIR,
    RETENTION_DAYS: '0',
  });
  dump = salida.trim().split('\n').pop();
  const bytes = Number(execFileSync('docker', ['exec', CONTAINER, 'stat', '-c', '%s', dump], { encoding: 'utf8' }).trim());
  ok(`backup tomado · ${(bytes / 1024).toFixed(0)} KB`);
} catch (e) {
  bad('el backup falló', String(e.stderr ?? e.message).slice(-600));
  process.exit(1);
}

// ── 3. DESTRUIR ───────────────────────────────────────────────────────────────
await sql(`DROP DATABASE ${DB} WITH (FORCE)`);
const sigueViva = await sql(`SELECT 1 FROM pg_database WHERE datname = '${DB}'`);
if (sigueViva.length === 0) ok('base DESTRUIDA (DROP DATABASE) — el escenario que el backup tiene que cubrir');
else bad('la base no se destruyó: el resto de la prueba no probaría nada');

// ── 4. Restaurar ──────────────────────────────────────────────────────────────
await sql(`CREATE DATABASE ${DB}`);
try {
  runInContainer('deploy/backup/restore.sh', [dump], {
    DATABASE_ADMIN_URL: dbUrlInContainer(DB),
    RESTORE_CONFIRM: 'si',
  });
  ok('restore ejecutado');
} catch (e) {
  bad('el restore falló', String(e.stdout ?? '').slice(-400) + String(e.stderr ?? e.message).slice(-600));
  process.exit(1);
}

// ── 5. ¿Volvieron los MISMOS datos? ───────────────────────────────────────────
const despues = await fingerprint();
for (const t of TABLAS) {
  if (antes.counts[t] === despues.counts[t]) ok(`${t}: ${despues.counts[t]} filas (idéntico)`);
  else bad(`${t} no coincide`, `antes ${antes.counts[t]} · después ${despues.counts[t]}`);
}
if (JSON.stringify(antes.versiones) === JSON.stringify(despues.versiones))
  ok(`schema_migrations restaurada íntegra (${despues.versiones.join(', ')})`);
else bad('las migraciones registradas no coinciden', `antes ${antes.versiones} · después ${despues.versiones}`);

// La vista derivada es el canario de que el restore trajo algo más que tablas: si `v_weighings`
// no volvió, la GDP —regla única del sistema— quedaría rota en toda la app.
const vista = await sql(`SELECT count(*)::int AS n FROM v_weighings`, DB).catch(() => null);
if (vista) ok(`la vista v_weighings volvió y responde (${vista[0].n} filas)`);
else bad('v_weighings no existe tras el restore: la GDP quedaría rota');

// ── 6. ¿La APP funciona sobre lo restaurado? ──────────────────────────────────
try {
  // SEED_DEMO off: si los datos no volvieran, no hay nada que los reponga.
  api = await bootApi('off');
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'cowinance@gmail.com', password: 'cowinance' }),
  });
  const { access_token } = await login.json();
  if (login.ok && access_token) ok('login contra la base restaurada (identidad y hashes intactos)');
  else bad('no se pudo iniciar sesión tras el restore', `HTTP ${login.status}`);

  // Un endpoint que COMPONE varios módulos (hato, tareas, alertas, sanidad, reproducción): si
  // responde con datos, volvió mucho más que las filas. La igualdad exacta por tabla ya se
  // verificó arriba; acá lo que importa es que la app pueda leerlas.
  const home = await fetch(`${API}/dashboard/home`, { headers: { authorization: `Bearer ${access_token}` } });
  const json = await home.json();
  if (home.ok && json?.kpis?.active_animals > 0)
    ok(`/dashboard/home compone sobre la base restaurada (activos=${json.kpis.active_animals})`);
  else bad('la app no funciona sobre la base restaurada', `HTTP ${home.status}`);
} catch (e) {
  bad('la app no arrancó contra la base restaurada', String(e.message).slice(-600));
} finally {
  api?.stop();
}

// ── Limpieza ──────────────────────────────────────────────────────────────────
await sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
execFileSync('docker', ['exec', CONTAINER, 'rm', '-rf', DUMP_DIR]);

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1m✓ El procedimiento de backup y restore funciona de punta a punta.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m✗ ${failures} aserción(es) fallaron.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
