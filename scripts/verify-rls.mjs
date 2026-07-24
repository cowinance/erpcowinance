#!/usr/bin/env node
/**
 * verify:rls — comprueba que el aislamiento multi-tenant REALMENTE aísla, sobre PostgreSQL real.
 *
 * POR QUÉ EXISTE
 * En desarrollo la app corre sobre PGlite, que conecta como SUPERUSUARIO. Un superusuario SALTEA
 * RLS aunque la política exista: las policies se crean, pero nunca se ejercen. Es decir, hasta
 * ahora el aislamiento por tenant era una promesa sin probar — el riesgo latente más serio del
 * sistema, porque una fuga cross-tenant recién aparecería en producción.
 *
 * QUÉ HACE
 *   1. Carga el DDL canónico (packages/db/cowinance_schema.sql) en el Postgres del compose.
 *   2. Aplica las políticas usando `rlsMigration()` de apps/api/src/db/rls.ts — la MISMA fuente
 *      que usa el arranque de la app. Si esto se duplicara, se estaría verificando otra cosa.
 *   3. Crea un rol NO privilegiado (`app_user`), que es como debe conectarse la app en prod.
 *   4. Siembra dos tenants con datos y ejerce el aislamiento COMO ESE ROL.
 *
 * Sale con código ≠ 0 si alguna aserción falla. Uso:
 *   docker compose up -d db && npm run verify:rls
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONTAINER = 'cowinance-pg';
const DB = 'cowinance';
const APP_ROLE = 'app_user';

const TA = '11111111-1111-1111-1111-111111111111';
const TB = '22222222-2222-2222-2222-222222222222';

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

/** SQL como superusuario contra una base dada (se usa para crear/borrar la base de prueba). */
function sql(text, db) {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAq', '-f', '-'], {
    input: text,
    encoding: 'utf8',
  }).trim();
}

console.log('\n\x1b[1m══ verify:rls — aislamiento por tenant sobre PostgreSQL real\x1b[0m\n');

// ── 1. Esquema canónico ────────────────────────────────────────────────────────
console.log('\x1b[2mPreparando base…\x1b[0m');
sql(`DROP DATABASE IF EXISTS ${DB}_rls;`, 'postgres');
sql(`CREATE DATABASE ${DB}_rls;`, 'postgres');
const DBT = `${DB}_rls`;
const schema = readFileSync(join(ROOT, 'packages/db/cowinance_schema.sql'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'rls-'));
writeFileSync(join(tmp, 'schema.sql'), schema);
execFileSync('docker', ['cp', join(tmp, 'schema.sql'), `${CONTAINER}:/tmp/schema.sql`]);
execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DBT, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/tmp/schema.sql'], { stdio: 'pipe' });
const tables = execFileSync(
  'docker',
  ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DBT, '-tAc', `select count(*) from information_schema.tables where table_schema='public'`],
  { encoding: 'utf8' },
).trim();
console.log(`  esquema canónico cargado (${tables} tablas, PostGIS activo)`);

// ── 2. Políticas: MISMA fuente que la app ──────────────────────────────────────
const { rlsMigration, RLS_TABLES } = await import(join(ROOT, 'apps/api/dist/db/rls.js'));

// El DDL canónico NO trae las tablas que la app crea en sus migraciones de arranque
// (task_events, repro_protocol_assignments, clinical_cases, sync_row_state…). Se verifica sobre
// las que existen acá; la cobertura de TODAS está cubierta por el guardarraíl que corre en la
// suite (apps/api/src/db/rls-coverage.guardrail.integration.test.ts).
const existing = execFileSync(
  'docker',
  ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DBT, '-tAc', `select tablename from pg_tables where schemaname='public'`],
  { encoding: 'utf8' },
).trim().split('\n');
const covered = RLS_TABLES.filter((t) => existing.includes(t));
const skipped = RLS_TABLES.filter((t) => !existing.includes(t));
writeFileSync(join(tmp, 'rls.sql'), rlsMigration(covered));
execFileSync('docker', ['cp', join(tmp, 'rls.sql'), `${CONTAINER}:/tmp/rls.sql`]);
execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DBT, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/tmp/rls.sql'], { stdio: 'pipe' });
console.log(`  políticas aplicadas desde apps/api/src/db/rls.ts (${covered.length} tablas)`);
if (skipped.length) console.log(`  \x1b[2m${skipped.length} omitidas: las crea la app al arrancar, no el DDL canónico\x1b[0m`);
console.log();

const sqlT = (text) =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DBT, '-v', 'ON_ERROR_STOP=1', '-tAq', '-f', '-'], {
    input: text,
    encoding: 'utf8',
  }).trim();
const asAppTRaw = (text) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD=app', CONTAINER, 'psql', '-U', APP_ROLE, '-h', '127.0.0.1', '-d', DBT, '-v', 'ON_ERROR_STOP=1', '-tAq', '-f', '-'],
    { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
/** Como asAppTRaw pero tolerante: si la sentencia falla devuelve null en vez de tirar, para que
 *  una aserción rota se reporte como ✗ y no tumbe la verificación entera. */
const asAppT = (text) => {
  try {
    return asAppTRaw(text);
  } catch {
    return null;
  }
};
/** Igual, pero se ESPERA que falle (el rechazo de RLS es el resultado buscado). */
const asAppTErr = (text) => {
  try {
    execFileSync(
      'docker',
      ['exec', '-i', '-e', 'PGPASSWORD=app', CONTAINER, 'psql', '-U', APP_ROLE, '-h', '127.0.0.1', '-d', DBT, '-v', 'ON_ERROR_STOP=1', '-tAq', '-f', '-'],
      { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return null;
  } catch (e) {
    return String(e.stderr ?? e.message).trim();
  }
};

// ── 3. Rol de la app: NO superusuario (si no, saltearía RLS) ───────────────────
sqlT(`
  DROP ROLE IF EXISTS ${APP_ROLE};
  CREATE ROLE ${APP_ROLE} LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS;
  GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
`);
const roleInfo = sqlT(`select rolsuper::text || '|' || rolbypassrls::text from pg_roles where rolname='${APP_ROLE}'`);
if (roleInfo === 'false|false') ok(`rol ${APP_ROLE}: NOSUPERUSER + NOBYPASSRLS (la RLS le aplica)`);
else bad(`rol ${APP_ROLE} privilegiado`, `rolsuper|rolbypassrls = ${roleInfo}`);

// ── 4. Datos de dos tenants (como superusuario, para tener qué aislar) ─────────
sqlT(`
  -- Catálogos globales mínimos: organizations/companies tienen FK a countries y currencies.
  INSERT INTO countries (code, name, name_en) VALUES ('AR','Argentina','Argentina') ON CONFLICT DO NOTHING;
  INSERT INTO currencies (code, name, symbol) VALUES ('ARS','Peso argentino','$') ON CONFLICT DO NOTHING;
  INSERT INTO organizations (id, name, country_code, default_currency) VALUES ('${TA}','Tenant A','AR','ARS'), ('${TB}','Tenant B','AR','ARS');
  INSERT INTO companies (id, tenant_id, name, country_code, functional_currency) VALUES
    ('${TA.replace(/1/g, 'a')}','${TA}','Empresa A','AR','ARS'), ('${TB.replace(/2/g, 'b')}','${TB}','Empresa B','AR','ARS');
  INSERT INTO farms (id, tenant_id, company_id, name) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a','${TA}','${TA.replace(/1/g, 'a')}','Finca A'),
    ('bbbbbbbb-0000-0000-0000-00000000000b','${TB}','${TB.replace(/2/g, 'b')}','Finca B');
`);
ok('sembrados 2 tenants con datos (companies + farms)');

console.log('\n\x1b[1m── Aserciones de aislamiento (conectado como el rol de la app)\x1b[0m');

// A) Con app.tenant_id = A → solo se ven las filas de A.
const seenA = asAppT(`SET app.tenant_id = '${TA}'; SELECT count(*) FROM farms;`);
const namesA = asAppT(`SET app.tenant_id = '${TA}'; SELECT string_agg(name,',') FROM farms;`);
if (seenA === '1' && namesA === 'Finca A') ok(`tenant A ve solo lo suyo (${seenA} finca: ${namesA})`);
else bad('tenant A ve filas de más', `count=${seenA} names=${namesA}`);

// B) El tenant B no ve nada de A.
const namesB = asAppT(`SET app.tenant_id = '${TB}'; SELECT string_agg(name,',') FROM farms;`);
if (namesB === 'Finca B') ok(`tenant B ve solo lo suyo (${namesB})`);
else bad('fuga cross-tenant', `B ve: ${namesB}`);

// C) SIN la variable de sesión → cero filas (fail-closed, no "todo").
const noVar = asAppT(`SELECT count(*) FROM farms;`);
if (noVar === '0') ok('sin app.tenant_id → 0 filas (fail-closed)');
else bad('sin app.tenant_id devuelve filas', `count=${noVar}`);

// D) No se puede ESCRIBIR en otro tenant (WITH CHECK).
const err = asAppTErr(`
  SET app.tenant_id = '${TA}';
  INSERT INTO farms (tenant_id, company_id, name)
  VALUES ('${TB}','${TB.replace(/2/g, 'b')}','Finca intrusa');
`);
if (err && /row-level security|violates/i.test(err)) ok('escribir en otro tenant → rechazado por RLS (WITH CHECK)');
else bad('se pudo insertar en otro tenant', err ?? 'el INSERT no falló');

// E) No se puede modificar una fila ajena (UPDATE no alcanza filas de otro tenant).
const upd = asAppT(`SET app.tenant_id = '${TA}'; UPDATE farms SET name='hackeada' WHERE name='Finca B'; SELECT count(*) FROM farms WHERE name='hackeada';`);
const stillB = sqlT(`SELECT name FROM farms WHERE tenant_id='${TB}'`);
if (upd === '0' && stillB === 'Finca B') ok('UPDATE no alcanza filas de otro tenant');
else bad('UPDATE cruzó el tenant', `afectadas=${upd} B ahora=${stillB}`);

// F) Idem DELETE.
asAppT(`SET app.tenant_id = '${TA}'; DELETE FROM farms WHERE name='Finca B';`);
const survives = sqlT(`SELECT count(*) FROM farms WHERE tenant_id='${TB}'`);
if (survives === '1') ok('DELETE no alcanza filas de otro tenant');
else bad('DELETE borró filas de otro tenant', `quedan=${survives}`);

// G) La protección alcanza a TODAS las tablas declaradas, no solo a la de ejemplo.
const unprotected = sqlT(`
  SELECT coalesce(string_agg(t,','),'') FROM unnest(ARRAY[${covered.map((t) => `'${t}'`).join(',')}]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t AND p.policyname='tenant_isolation'
  );
`);
if (!unprotected) ok(`las ${covered.length} tablas verificadas tienen la política aplicada`);
else bad('tablas declaradas sin política', unprotected);

// H) Y está FORZADA: sin FORCE, el dueño de la tabla la saltearía.
const notForced = sqlT(`
  SELECT coalesce(string_agg(relname,','),'') FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity
    AND relname = ANY(ARRAY[${covered.map((t) => `'${t}'`).join(',')}]);
`);
if (!notForced) ok('RLS FORZADA en todas (el owner tampoco la saltea)');
else bad('RLS sin FORCE', notForced);

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1m✓ El aislamiento por tenant funciona sobre PostgreSQL real.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m✗ ${failures} aserción(es) fallaron.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
