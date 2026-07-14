/**
 * Guardia RLS de payroll_runs + payroll_items (H-2). Verifica bajo rol NO-super que la política
 * estándar `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige la
 * dispersa del schema sobre `app.current_tenant`. Self-contained.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CO = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const R = '11111111-1111-1111-1111-111111111111';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE payroll_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    period date NOT NULL DEFAULT now(), status varchar(255) NOT NULL DEFAULT 'draft', total_amount numeric(16,2) NOT NULL DEFAULT 0,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE payroll_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, payroll_run_id uuid NOT NULL,
    employee_id uuid NOT NULL, gross numeric(16,2) NOT NULL, deductions numeric(16,2) NOT NULL DEFAULT 0, net numeric(16,2) NOT NULL,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
`);

for (const tbl of ['payroll_runs', 'payroll_items']) {
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
  INSERT INTO payroll_runs (id, tenant_id, company_id, total_amount) VALUES ('${R}','${A}','${CO}',1000), (gen_random_uuid(),'${B}','${CO}',2000);
  INSERT INTO payroll_items (tenant_id, payroll_run_id, employee_id, gross, net) VALUES ('${A}','${R}',gen_random_uuid(),1000,830), ('${B}',gen_random_uuid(),gen_random_uuid(),2000,1660);
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

console.log('── Guardia RLS de payroll_runs/payroll_items (rol no-super) ──');

for (const tbl of ['payroll_runs', 'payroll_items']) {
  const aSees = await inCtx(A, () => db.query(`SELECT id FROM ${tbl}`));
  aSees.rows.length === 1 ? ok(`${tbl}: tenant A ve solo su fila`) : bad(`${tbl}: A debería ver 1`, JSON.stringify(aSees.rows));
}
try {
  await inCtx(A, () => db.query(`INSERT INTO payroll_items (tenant_id, payroll_run_id, employee_id, gross, net) VALUES ($1,$2,gen_random_uuid(),1,1)`, [B, R]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE payroll_runs SET status='hack' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar liquidaciones de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
