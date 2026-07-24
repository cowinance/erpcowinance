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
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// Cliente `pg` en vez de `docker exec psql`: así corre igual en local (docker-compose) y en CI
// (service container), donde el contenedor no es accesible por nombre. PG_URL lo parametriza.
const PG_URL = process.env.PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/postgres';
const dbUrl = (name, user, pass) => {
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  if (user) u.username = user;
  if (pass) u.password = pass;
  return u.toString();
};
const DB = 'cowinance';
// Rol propio (no `app_user`): así este script y `verify:pg` no se pisan entre sí.
const APP_ROLE = 'rls_probe';

const TA = '11111111-1111-1111-1111-111111111111';
const TB = '22222222-2222-2222-2222-222222222222';

/** Ejecuta SQL y devuelve el primer valor escalar del último statement (o '' si no hay filas). */
async function run(url, text) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(text);
    const rows = Array.isArray(r) ? r[r.length - 1]?.rows : r.rows;
    if (!rows?.length) return '';
    return String(Object.values(rows[0])[0] ?? '');
  } finally {
    await c.end();
  }
}

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, d) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ''}`);
};

console.log('\n\x1b[1m══ verify:rls — aislamiento por tenant sobre PostgreSQL real\x1b[0m\n');

// ── 1. Esquema canónico ────────────────────────────────────────────────────────
console.log('\x1b[2mPreparando base…\x1b[0m');
const DBT = `${DB}_rls`;
await run(dbUrl('postgres'), `DROP DATABASE IF EXISTS ${DBT};`);
await run(dbUrl('postgres'), `CREATE DATABASE ${DBT};`);
await run(dbUrl(DBT), readFileSync(join(ROOT, 'packages/db/cowinance_schema.sql'), 'utf8'));
const tables = await run(dbUrl(DBT), `select count(*) from information_schema.tables where table_schema='public'`);
console.log(`  esquema canónico cargado (${tables} tablas, PostGIS activo)`);

// ── 2. Políticas: MISMA fuente que la app ──────────────────────────────────────
const { rlsMigration, RLS_TABLES } = await import(join(ROOT, 'apps/api/dist/db/rls.js'));

// El DDL canónico NO trae las tablas que la app crea en sus migraciones de arranque
// (task_events, repro_protocol_assignments, clinical_cases, sync_row_state…). Se verifica sobre
// las que existen acá; la cobertura de TODAS está cubierta por el guardarraíl que corre en la
// suite (apps/api/src/db/rls-coverage.guardrail.integration.test.ts).
const existing = (
  await (async () => {
    const c = new pg.Client({ connectionString: dbUrl(DBT) });
    await c.connect();
    const r = await c.query(`select tablename from pg_tables where schemaname='public'`);
    await c.end();
    return r.rows.map((x) => x.tablename);
  })()
);
const covered = RLS_TABLES.filter((t) => existing.includes(t));
const skipped = RLS_TABLES.filter((t) => !existing.includes(t));
await run(dbUrl(DBT), rlsMigration(covered));
console.log(`  políticas aplicadas desde apps/api/src/db/rls.ts (${covered.length} tablas)`);
if (skipped.length) console.log(`  \x1b[2m${skipped.length} omitidas: las crea la app al arrancar, no el DDL canónico\x1b[0m`);
console.log();

/** SQL como superusuario sobre la base de prueba. Devuelve el primer valor escalar. */
const sqlT = async (text) => run(dbUrl(DBT), text);
/** SQL COMO EL ROL RESTRINGIDO — así se ejerce la RLS de verdad. */
const asAppT = async (text) => run(dbUrl(DBT, APP_ROLE, 'app'), text);
/** Igual, pero se ESPERA que falle (el rechazo de RLS es el resultado buscado). */
const asAppTErr = async (text) => {
  try {
    await run(dbUrl(DBT, APP_ROLE, 'app'), text);
    return null;
  } catch (e) {
    return String(e.message ?? e).trim();
  }
};

// ── 3. Rol de la app: NO superusuario (si no, saltearía RLS) ───────────────────
await sqlT(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;
  GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
`);
const roleInfo = await sqlT(`select rolsuper::text || '|' || rolbypassrls::text from pg_roles where rolname='${APP_ROLE}'`);
if (roleInfo === 'false|false') ok(`rol ${APP_ROLE}: NOSUPERUSER + NOBYPASSRLS (la RLS le aplica)`);
else bad(`rol ${APP_ROLE} privilegiado`, `rolsuper|rolbypassrls = ${roleInfo}`);

// ── 4. Datos de dos tenants (como superusuario, para tener qué aislar) ─────────
await sqlT(`
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
const seenA = await asAppT(`SET app.tenant_id = '${TA}'; SELECT count(*) FROM farms;`);
const namesA = await asAppT(`SET app.tenant_id = '${TA}'; SELECT string_agg(name,',') FROM farms;`);
if (seenA === '1' && namesA === 'Finca A') ok(`tenant A ve solo lo suyo (${seenA} finca: ${namesA})`);
else bad('tenant A ve filas de más', `count=${seenA} names=${namesA}`);

// B) El tenant B no ve nada de A.
const namesB = await asAppT(`SET app.tenant_id = '${TB}'; SELECT string_agg(name,',') FROM farms;`);
if (namesB === 'Finca B') ok(`tenant B ve solo lo suyo (${namesB})`);
else bad('fuga cross-tenant', `B ve: ${namesB}`);

// C) SIN la variable de sesión → cero filas (fail-closed, no "todo").
const noVar = await asAppT(`SELECT count(*) FROM farms;`);
if (noVar === '0') ok('sin app.tenant_id → 0 filas (fail-closed)');
else bad('sin app.tenant_id devuelve filas', `count=${noVar}`);

// D) No se puede ESCRIBIR en otro tenant (WITH CHECK).
const err = await asAppTErr(`
  SET app.tenant_id = '${TA}';
  INSERT INTO farms (tenant_id, company_id, name)
  VALUES ('${TB}','${TB.replace(/2/g, 'b')}','Finca intrusa');
`);
if (err && /row-level security|violates/i.test(err)) ok('escribir en otro tenant → rechazado por RLS (WITH CHECK)');
else bad('se pudo insertar en otro tenant', err ?? 'el INSERT no falló');

// E) No se puede modificar una fila ajena (UPDATE no alcanza filas de otro tenant).
const upd = await asAppT(`SET app.tenant_id = '${TA}'; UPDATE farms SET name='hackeada' WHERE name='Finca B'; SELECT count(*) FROM farms WHERE name='hackeada';`);
const stillB = await sqlT(`SELECT name FROM farms WHERE tenant_id='${TB}'`);
if (upd === '0' && stillB === 'Finca B') ok('UPDATE no alcanza filas de otro tenant');
else bad('UPDATE cruzó el tenant', `afectadas=${upd} B ahora=${stillB}`);

// F) Idem DELETE.
await asAppT(`SET app.tenant_id = '${TA}'; DELETE FROM farms WHERE name='Finca B';`);
const survives = await sqlT(`SELECT count(*) FROM farms WHERE tenant_id='${TB}'`);
if (survives === '1') ok('DELETE no alcanza filas de otro tenant');
else bad('DELETE borró filas de otro tenant', `quedan=${survives}`);

// G) La protección alcanza a TODAS las tablas declaradas, no solo a la de ejemplo.
const unprotected = await sqlT(`
  SELECT coalesce(string_agg(t,','),'') FROM unnest(ARRAY[${covered.map((t) => `'${t}'`).join(',')}]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t AND p.policyname='tenant_isolation'
  );
`);
if (!unprotected) ok(`las ${covered.length} tablas verificadas tienen la política aplicada`);
else bad('tablas declaradas sin política', unprotected);

// H) Y está FORZADA: sin FORCE, el dueño de la tabla la saltearía.
const notForced = await sqlT(`
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
