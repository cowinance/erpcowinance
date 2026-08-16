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
import { fileURLToPath, pathToFileURL } from 'url';
import pg from 'pg';

/**
 * Ruta del sistema → URL `file://` para poder importarla.
 *
 * `import()` espera un especificador, no una ruta: en Windows `C:\…` se interpreta como esquema de
 * URL y falla con `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Mismo motivo y misma solución que en
 * `verify-rls.mjs`.
 */
const comoUrl = (ruta) => pathToFileURL(ruta).href;

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// Conexión al Postgres de pruebas. Por defecto el del docker-compose; en CI se apunta al service
// container con PG_URL. Se usa el cliente `pg` (no `docker exec psql`) para que el script sirva
// igual en local y en CI, donde el contenedor del service no es accesible por nombre.
const PG_URL = process.env.PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/postgres';
const base = new URL(PG_URL);
const dbUrl = (name) => {
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  return u.toString();
};
const DB = 'app_verify';
const PORT = 3057;
const API = `http://127.0.0.1:${PORT}/v1`;
// CLAVE: la app sirve con un rol RESTRINGIDO (NOSUPERUSER NOBYPASSRLS). Si conectara como
// `postgres`, sería superusuario y SALTEARÍA la RLS: el aislamiento que veríamos sería solo el
// filtro por tenant que hacen las queries, no la política. El DDL de arranque va por la conexión
// admin, igual que en producción (migrar con privilegios, servir con los mínimos).
const URL_ADMIN = dbUrl(DB);
const URL_APP = (() => {
  const u = new URL(dbUrl(DB));
  u.username = 'app_user';
  u.password = 'app';
  return u.toString();
})();

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

/** SQL administrativo. Devuelve la primera columna de la primera fila (o '' si no hay filas). */
const psql = async (sql, db = base.pathname.slice(1) || 'postgres') => {
  const c = new pg.Client({ connectionString: dbUrl(db) });
  await c.connect();
  try {
    const r = await c.query(sql);
    const rows = Array.isArray(r) ? r[r.length - 1]?.rows : r.rows;
    if (!rows?.length) return '';
    return String(Object.values(rows[0])[0] ?? '');
  } finally {
    await c.end();
  }
};

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
await psql(`DROP DATABASE IF EXISTS ${DB};`);
await psql(`CREATE DATABASE ${DB};`);
// Rol de servicio + privilegios por defecto: las tablas las crea el arranque (rol admin), así que
// se conceden de antemano para todo lo que se cree después.
await psql(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
      CREATE ROLE app_user LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;
`);
await psql(
  `
  GRANT USAGE ON SCHEMA public TO app_user;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
`,
  DB,
);

// `shell: true` porque en Windows `npm` es `npm.cmd`: sin shell, `execFileSync` busca un
// ejecutable llamado exactamente «npm», no lo encuentra y tira ENOENT. En POSIX no cambia nada.
execFileSync('npm', ['run', 'build', '-w', '@cowinance/api'], { cwd: ROOT, stdio: 'pipe', shell: true });

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

  const roleFlags = await psql(`select rolsuper::text||'|'||rolbypassrls::text from pg_roles where rolname='app_user'`);
  if (roleFlags === 'false|false') ok('la app sirve con un rol restringido (NOSUPERUSER NOBYPASSRLS → la RLS le aplica)');
  else bad('el rol de servicio puede saltear la RLS', `rolsuper|rolbypassrls = ${roleFlags}`);

  // Y la app lo COMPROBÓ por su cuenta al arrancar, que es lo que protege a un despliegue donde
  // nadie corre este script.
  if (/sin SUPERUSER ni BYPASSRLS/.test(bootLog)) ok('la app verifica sus propios privilegios al arrancar y lo registra');
  else bad('la guardia de privilegios no dejó rastro en el arranque', bootLog.slice(-400));

  if (/PostgreSQL real \(DATABASE_URL\)/.test(bootLog)) ok('arranca usando el driver de PostgreSQL (no PGlite)');
  else bad('no se confirmó el driver de PostgreSQL', bootLog.slice(0, 400));

  const rls = /RLS forzada en (\d+) tablas/.exec(bootLog);
  if (rls) ok(`esquema + migraciones + seed aplicados (RLS en ${rls[1]} tablas)`);
  else bad('no se completó el arranque de la base', bootLog.slice(-600));

  // Dos tenants distintos del seed demo. Las credenciales se IMPORTAN del seed compilado, igual
  // que `rls.js`: escritas a mano acá, se separaron del seed cuando la finca de ejemplo pasó a ser
  // venezolana y este script quedó autenticándose contra un usuario inexistente.
  const { DEMO_ACCOUNTS } = await import(comoUrl(join(ROOT, 'apps/api/dist/db/seed.js')));
  const a = await api('/auth/login', { method: 'POST', body: { email: DEMO_ACCOUNTS.a.email, password: DEMO_ACCOUNTS.a.password } });
  const b = await api('/auth/login', { method: 'POST', body: { email: DEMO_ACCOUNTS.b.email, password: DEMO_ACCOUNTS.b.password } });
  const TA = a.json?.access_token;
  const TB = b.json?.access_token;
  if (TA && TB) ok('login de dos tenants distintos');
  else bad('no se pudo autenticar', `A=${a.status} (${DEMO_ACCOUNTS.a.email}) B=${b.status} (${DEMO_ACCOUNTS.b.email})`);

  const listA = await api('/animals?limit=500', { token: TA });
  const listB = await api('/animals?limit=500', { token: TB });
  const idsA = new Set((listA.json?.data ?? []).map((x) => x.id));
  const idsB = new Set((listB.json?.data ?? []).map((x) => x.id));
  const hayDatos = idsA.size > 0 && idsB.size > 0;
  if (hayDatos) ok(`cada tenant ve su hato (A=${idsA.size}, B=${idsB.size})`);
  else bad('alguna lista vino vacía', `A=${idsA.size} B=${idsB.size}`);

  /**
   * La aserción MÁS IMPORTANTE del script, y la que estuvo pasando en verde por el motivo
   * equivocado durante tres semanas: con el login de B roto su lista venía vacía, y la
   * intersección de 66 ids contra un conjunto vacío da cero — «sin fuga» ✓, sin haber comparado
   * nada. Un control que no puede fallar cuando su preparación se rompe es peor que no tenerlo,
   * porque además tranquiliza.
   *
   * Por eso ahora exige tener los dos hatos: sin datos de ambos lados no hay veredicto.
   */
  const overlap = [...idsA].filter((id) => idsB.has(id));
  if (!hayDatos) bad('no se pudo comparar el solapamiento', 'una de las dos listas vino vacía: sin los dos hatos esta prueba no significa nada');
  else if (overlap.length === 0) ok(`los hatos no se solapan (sin fuga en el listado; ${idsA.size} vs ${idsB.size} comparados)`);
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

// ── La guardia de privilegios, probada EN NEGATIVO ─────────────────────────────
//
// Que la app registre «sin SUPERUSER ni BYPASSRLS» cuando todo está bien no prueba gran cosa: un
// `console.log` fijo pasaría igual. Lo que hay que demostrar es que la guardia DISPARA — que con un
// rol capaz de saltear la RLS, la app de producción se NIEGA a arrancar.
//
// Se ejerce sobre BYPASSRLS y no sobre SUPERUSER a propósito: es el más fácil de conceder sin
// darse cuenta (un `GRANT` de más, un rol heredado) y el que no salta a la vista revisando quién es
// superusuario.
console.log('\n\x1b[1m── Guardia de privilegios del rol de servicio\x1b[0m');

/** Arranca el binario con el env dado y devuelve {code, log} cuando el proceso termina solo. */
const bootUntilExit = (env, timeoutMs = 90_000) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js')], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {}
      resolve({ code: 'timeout', log });
    }, timeoutMs);
    p.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });

const PROD_ENV = {
  DATABASE_URL: URL_APP,
  DATABASE_ADMIN_URL: URL_ADMIN,
  NODE_ENV: 'production',
  SEED_DEMO: 'off',
  PORT: String(PORT + 1),
  EMAIL_PROVIDER: 'log',
  // Producción exige clave propia (≥32, ≠ la de dev). Sin esto el proceso muere por OTRO motivo y
  // la prueba diría «no arrancó» sin haber ejercido nada.
  JWT_SECRET: 'clave-de-verificacion-suficientemente-larga-0123456789',
};

await psql(`ALTER ROLE app_user BYPASSRLS;`);
try {
  const flags = await psql(`select rolbypassrls::text from pg_roles where rolname='app_user'`);
  if (flags !== 'true') bad('no se pudo conceder BYPASSRLS para la prueba', `rolbypassrls=${flags}`);

  const caido = await bootUntilExit(PROD_ENV);
  if (caido.code !== 0 && caido.code !== 'timeout' && /BYPASSRLS/.test(caido.log))
    ok(`con BYPASSRLS la app de producción NO arranca (exit ${caido.code})`);
  else bad('la app arrancó con un rol que saltea la RLS', `exit=${caido.code} ${caido.log.slice(-500)}`);

  if (/ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS/.test(caido.log))
    ok('el mensaje trae el comando exacto para arreglarlo');
  else bad('el mensaje de error no dice cómo corregirlo', caido.log.slice(-400));

  // Y no llegó a tocar el esquema: la guardia corre ANTES del DDL, así que un despliegue mal
  // configurado se detiene sin haber migrado a medias.
  if (!/Migraciones pendientes/.test(caido.log)) ok('aborta ANTES de correr migraciones');
  else bad('alcanzó a migrar antes de abortar', caido.log.slice(-400));
} finally {
  // Devolver el rol a su estado sano SIEMPRE: si esto no corre, la próxima corrida del script
  // arrancaría con un rol privilegiado y las aserciones de aislamiento pasarían por la razón
  // equivocada.
  await psql(`ALTER ROLE app_user NOBYPASSRLS;`);
}

// Restituido: la app vuelve a arrancar. Cierra el ciclo — demuestra que lo que la frenaba era el
// privilegio y no cualquier otra cosa del entorno de producción.
const sano = await bootUntilExit({ ...PROD_ENV, PORT: String(PORT + 2) }, 25_000);
if (sano.code === 'timeout' && /sin SUPERUSER ni BYPASSRLS/.test(sano.log))
  ok('quitado el BYPASSRLS, la misma configuración arranca y sirve');
else bad('la app no arrancó con el rol ya restringido', `exit=${sano.code} ${sano.log.slice(-500)}`);

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1m✓ La app corre sobre PostgreSQL real y el aislamiento se sostiene por HTTP.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m✗ ${failures} aserción(es) fallaron.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
