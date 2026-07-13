/**
 * Guardia RLS de repro_protocols (R-2.a). Verifica, bajo un rol NO-superusuario (como producción;
 * PGlite dev corre como superusuario y saltea RLS — ver memoria reference-pglite-superuser-rls),
 * que la política ESTÁNDAR `tenant_isolation` sobre `app.tenant_id` (la que aplica rlsMigration)
 * aísla correctamente: cada tenant ve/edita solo sus protocolos, y el WITH CHECK impide insertar
 * a nombre de otro tenant. Esto es lo que corrige el bug de la policy dispersa sobre
 * `app.current_tenant` (que la app nunca setea).
 *
 * Self-contained (no requiere la API). La política es idéntica a DbService.rlsMigration().
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE repro_protocols (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
    name varchar(255) NOT NULL, steps jsonb NOT NULL DEFAULT '[]',
    is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE repro_protocols ENABLE ROW LEVEL SECURITY;
  ALTER TABLE repro_protocols FORCE ROW LEVEL SECURITY;
  -- Política ESTÁNDAR idéntica a rlsMigration (app.tenant_id). NO la dispersa (app.current_tenant).
  CREATE POLICY tenant_isolation ON repro_protocols
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO repro_protocols (tenant_id, name) VALUES ('${A}', 'IATF A'), ('${B}', 'IATF B');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON repro_protocols TO appuser;
`);

async function inCtx(tenant, fn) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE appuser');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

console.log('── Guardia RLS de repro_protocols (rol no-super) ──');

// 1. Aislamiento de lectura.
const aSees = await inCtx(A, () => db.query('SELECT name FROM repro_protocols'));
aSees.rows.length === 1 && aSees.rows[0].name === 'IATF A' ? ok('tenant A ve solo su protocolo') : bad('A debería ver solo IATF A', JSON.stringify(aSees.rows));
const bSees = await inCtx(B, () => db.query('SELECT name FROM repro_protocols'));
bSees.rows.length === 1 && bSees.rows[0].name === 'IATF B' ? ok('tenant B ve solo su protocolo') : bad('B debería ver solo IATF B', JSON.stringify(bSees.rows));

// 2. INSERT propio OK.
try {
  await inCtx(A, () => db.query(`INSERT INTO repro_protocols (tenant_id, name) VALUES ($1,'IATF A2')`, [A]));
  ok('tenant A inserta un protocolo propio');
} catch (e) {
  bad('A debería poder insertar lo suyo', e.message);
}

// 3. WITH CHECK: A no puede insertar a nombre de B.
try {
  await inCtx(A, () => db.query(`INSERT INTO repro_protocols (tenant_id, name) VALUES ($1,'colado')`, [B]));
  bad('A NO debería poder insertar a nombre de B (WITH CHECK)');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}

// 4. A no puede actualizar el protocolo de B.
const upd = await inCtx(A, () => db.query(`UPDATE repro_protocols SET name='hackeado' WHERE name='IATF B' RETURNING id`));
upd.rows.length === 0 ? ok('A no puede actualizar el protocolo de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
