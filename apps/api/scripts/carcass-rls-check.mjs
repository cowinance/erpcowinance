/**
 * Guardia RLS de carcass_records (FA-1). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige la dispersa del
 * schema sobre `app.current_tenant`. Self-contained.
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
  CREATE TABLE carcass_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, animal_id uuid NOT NULL UNIQUE,
    slaughter_date date NOT NULL DEFAULT now(), hot_carcass_weight_kg numeric(14,3), dressing_pct numeric(14,3),
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE carcass_records ENABLE ROW LEVEL SECURITY;
  ALTER TABLE carcass_records FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON carcass_records
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO carcass_records (tenant_id, animal_id, hot_carcass_weight_kg) VALUES ('${A}', gen_random_uuid(), 270), ('${B}', gen_random_uuid(), 300);
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON carcass_records TO appuser;
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

console.log('── Guardia RLS de carcass_records (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT id FROM carcass_records'));
aSees.rows.length === 1 ? ok('tenant A ve solo su res') : bad('A debería ver 1', JSON.stringify(aSees.rows));
try {
  await inCtx(A, () => db.query(`INSERT INTO carcass_records (tenant_id, animal_id, hot_carcass_weight_kg) VALUES ($1, gen_random_uuid(), 999)`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE carcass_records SET dressing_pct=99 WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar faenas de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
