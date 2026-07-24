#!/usr/bin/env node
/**
 * verify:pg — corre LA APP ENTERA contra PostgreSQL real y comprueba el aislamiento por HTTP.
 *
 * QUÉ AGREGA sobre `verify:rls`
 * `verify:rls` prueba el MOTOR: que las políticas aíslan cuando `app.tenant_id` está bien puesto.
 * Pero eso deja fuera la otra mitad del contrato: que la app REALMENTE fije esa variable en cada
 * request. Ese es el trabajo del interceptor de auth (abre una tx y hace SET LOCAL con el tenant
 * del JWT); si se rompiera, `verify:rls` seguiría en verde y la fuga existiría igual.
 *
 * Acá se arranca el binario de producción con DATABASE_URL, se piden tokens de DOS tenants
 * distintos y se ejerce la frontera por HTTP: cada uno ve lo suyo, y uno NO puede leer ni
 * modificar un recurso del otro aunque conozca su id.
 *
 * Requiere `docker compose up -d db`. Uso: npm run verify:pg
 */
import { execFileSync, spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONTAINER = 'cowinance-pg';
const DB = 'app_verify';
const PORT = 3057;
const API = `http://127.0.0.1:${PORT}/v1`;
// CLAVE: la app sirve con un rol RESTRINGIDO (NOSUPERUSER NOBYPASSRLS). Si conectara como
// `postgres`, sería superusuario y SALTEARÍA la RLS: el aislamiento que veríamos sería solo el
// filtro por tenant que hacen las queries, no la política. El DDL de arranque va por la conexión
// admin, igual que en producción (migrar con privilegios, servir con los mínimos).
const URL_APP = `postgres://app_user:app@127.0.0.1:5434/${DB}`;
const URL_ADMIN = `postgres://postgres:postgres@127.0.0.1:5434/${DB}`;

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

const psql = (sql, db = 'postgres') =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAq', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  }).trim();

const api = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

console.log('\n\x1b[1m══ verify:pg — la app entera sobre PostgreSQL real\x1b[0m\n');

// Base limpia por corrida: el arranque de la app carga el DDL, migra y siembra.
console.log('\x1b[2mPreparando base…\x1b[0m');
psql(`DROP DATABASE IF EXISTS ${DB};`);
psql(`CREATE DATABASE ${DB};`);
// Rol de servicio + privilegios por defecto: las tablas las crea el arranque (rol admin), así que
// se conceden de antemano para todo lo que se cree después.
psql(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
      CREATE ROLE app_user LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;
`);
psql(
  `
  GRANT USAGE ON SCHEMA public TO app_user;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
`,
  DB,
);

execFileSync('npm', ['run', 'build', '-w', '@cowinance/api'], { cwd: ROOT, stdio: 'pipe' });

const api_proc = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: URL_APP, DATABASE_ADMIN_URL: URL_ADMIN, SEED_DEMO: 'on', PORT: String(PORT), EMAIL_PROVIDER: 'log' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
api_proc.stdout.on('data', (d) => (bootLog += d));
api_proc.stderr.on('data', (d) => (bootLog += d));

const stop = () => {
  try {
    api_proc.kill('SIGTERM');
  } catch {}
};
process.on('exit', stop);

try {
  // Esperar a que levante (el primer arranque carga el DDL + siembra).
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
    bad('la app no levantó contra PostgreSQL', bootLog.slice(-800));
    process.exit(1);
  }

  const roleFlags = psql(`select rolsuper::text||'|'||rolbypassrls::text from pg_roles where rolname='app_user'`);
  if (roleFlags === 'false|false') ok('la app sirve con un rol restringido (NOSUPERUSER NOBYPASSRLS → la RLS le aplica)');
  else bad('el rol de servicio puede saltear la RLS', `rolsuper|rolbypassrls = ${roleFlags}`);

  if (/PostgreSQL real \(DATABASE_URL\)/.test(bootLog)) ok('arranca usando el driver de PostgreSQL (no PGlite)');
  else bad('no se confirmó el driver de PostgreSQL', bootLog.slice(0, 400));

  const rls = /RLS forzada en (\d+) tablas/.exec(bootLog);
  if (rls) ok(`esquema + migraciones + seed aplicados (RLS en ${rls[1]} tablas)`);
  else bad('no se completó el arranque de la base', bootLog.slice(-600));

  // Dos tenants distintos del seed demo.
  const a = await api('/auth/login', { method: 'POST', body: { email: 'cowinance@gmail.com', password: 'cowinance' } });
  const b = await api('/auth/login', { method: 'POST', body: { email: 'maria@elombu.com', password: 'ombu1234' } });
  const TA = a.json?.access_token;
  const TB = b.json?.access_token;
  if (TA && TB) ok('login de dos tenants distintos');
  else bad('no se pudo autenticar', `A=${a.status} B=${b.status}`);

  const listA = await api('/animals?limit=500', { token: TA });
  const listB = await api('/animals?limit=500', { token: TB });
  const idsA = new Set((listA.json?.data ?? []).map((x) => x.id));
  const idsB = new Set((listB.json?.data ?? []).map((x) => x.id));
  if (idsA.size > 0 && idsB.size > 0) ok(`cada tenant ve su hato (A=${idsA.size}, B=${idsB.size})`);
  else bad('alguna lista vino vacía', `A=${idsA.size} B=${idsB.size}`);

  const overlap = [...idsA].filter((id) => idsB.has(id));
  if (overlap.length === 0) ok('los hatos no se solapan (sin fuga en el listado)');
  else bad('fuga cross-tenant en el listado', `${overlap.length} ids compartidos`);

  // La prueba fuerte: B conoce el id de A y aun así no lo alcanza.
  const target = [...idsA][0];
  const readB = await api(`/animals/${target}`, { token: TB });
  if (readB.status === 404) ok('B no puede LEER un animal de A aunque tenga su id (404)');
  else bad('B leyó un recurso de otro tenant', `HTTP ${readB.status}`);

  const writeB = await api(`/animals/${target}`, { token: TB, method: 'PUT', body: { name: 'hackeado' } });
  if (writeB.status === 404) ok('B no puede MODIFICARLO (404)');
  else bad('B modificó un recurso de otro tenant', `HTTP ${writeB.status}`);

  const readA = await api(`/animals/${target}`, { token: TA });
  if (readA.status === 200 && readA.json?.name !== 'hackeado') ok('A sigue viendo el suyo, intacto');
  else bad('el recurso de A cambió o no es accesible', `HTTP ${readA.status} name=${readA.json?.name}`);

  const anon = await api(`/animals/${target}`);
  if (anon.status === 401) ok('sin token → 401 (no hay lectura anónima)');
  else bad('acceso sin token', `HTTP ${anon.status}`);

  // Un endpoint que COMPONE varios módulos: prueba que la app real funciona, no solo el CRUD.
  const home = await api('/dashboard/home', { token: TA });
  if (home.status === 200 && home.json?.kpis?.active_animals > 0) {
    ok(`/dashboard/home compone sobre Postgres (activos=${home.json.kpis.active_animals}, agenda=${home.json.agenda?.length ?? 0})`);
  } else bad('/dashboard/home falló sobre Postgres', `HTTP ${home.status}`);
} finally {
  stop();
}

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1m✓ La app corre sobre PostgreSQL real y el aislamiento se sostiene por HTTP.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m✗ ${failures} aserción(es) fallaron.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
