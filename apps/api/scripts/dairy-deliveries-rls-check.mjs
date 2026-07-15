/**
 * Guardia RLS de milk_deliveries + milk_quality_tests (TB-2). Verifica bajo rol NO-super que la
 * política estándar `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige
 * la dispersa del schema sobre `app.current_tenant`. Self-contained.
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
  CREATE TABLE milk_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, delivered_at timestamptz NOT NULL DEFAULT now(),
    liters numeric(14,3) NOT NULL, price_per_liter numeric(18,4), deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE milk_quality_tests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, sample_date date NOT NULL DEFAULT now(),
    fat_pct numeric(14,3), deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
`);

for (const tbl of ['milk_deliveries', 'milk_quality_tests']) {
  await db.exec(`
    ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${tbl}
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    GRANT SELECT, INSERT, UPDATE ON ${tbl} TO appuser;
  `);
}

await db.exec(`
  INSERT INTO milk_deliveries (tenant_id, liters) VALUES ('${A}', 500), ('${B}', 800);
  INSERT INTO milk_quality_tests (tenant_id, fat_pct) VALUES ('${A}', 3.6), ('${B}', 3.8);
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

console.log('── Guardia RLS de entregas/calidad (rol no-super) ──');

for (const tbl of ['milk_deliveries', 'milk_quality_tests']) {
  const aSees = await inCtx(A, () => db.query(`SELECT id FROM ${tbl}`));
  aSees.rows.length === 1 ? ok(`${tbl}: tenant A ve solo su fila`) : bad(`${tbl}: A debería ver 1`, JSON.stringify(aSees.rows));
}
try {
  await inCtx(A, () => db.query(`INSERT INTO milk_deliveries (tenant_id, liters) VALUES ($1, 1)`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE milk_quality_tests SET fat_pct=0 WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar tests de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
