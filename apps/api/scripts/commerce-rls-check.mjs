/**
 * Guardia RLS del maestro comercial (C-1). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK) en el supertipo
 * (business_partners), un satélite (suppliers) y una tabla transaccional (sales). Corrige la dispersa
 * del schema sobre `app.current_tenant`. Self-contained.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CO = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE business_partners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    type varchar(255) NOT NULL, name varchar(255) NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, partner_id uuid NOT NULL UNIQUE,
    category varchar(255), deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    customer_partner_id uuid NOT NULL, sale_date date NOT NULL DEFAULT now(), type varchar(255) NOT NULL DEFAULT 'other',
    currency varchar(3) NOT NULL DEFAULT 'USD', total numeric(16,2) NOT NULL DEFAULT 0, status varchar(255) NOT NULL DEFAULT 'draft',
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
`);

for (const tbl of ['business_partners', 'suppliers', 'sales']) {
  await db.exec(`
    ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${tbl}
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    GRANT SELECT, INSERT, UPDATE ON ${tbl} TO appuser;
  `);
}

const P_A = '11111111-1111-1111-1111-111111111111';
const P_B = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  INSERT INTO business_partners (id, tenant_id, company_id, type, name) VALUES ('${P_A}','${A}','${CO}','both','A'), ('${P_B}','${B}','${CO}','both','B');
  INSERT INTO suppliers (tenant_id, partner_id) VALUES ('${A}','${P_A}'), ('${B}','${P_B}');
  INSERT INTO sales (tenant_id, company_id, customer_partner_id) VALUES ('${A}','${CO}','${P_A}'), ('${B}','${CO}','${P_B}');
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

console.log('── Guardia RLS del maestro comercial (rol no-super) ──');

for (const tbl of ['business_partners', 'suppliers', 'sales']) {
  const aSees = await inCtx(A, () => db.query(`SELECT id FROM ${tbl}`));
  aSees.rows.length === 1 ? ok(`${tbl}: tenant A ve solo su fila`) : bad(`${tbl}: A debería ver 1`, JSON.stringify(aSees.rows));
}

try {
  await inCtx(A, () => db.query(`INSERT INTO suppliers (tenant_id, partner_id) VALUES ($1, gen_random_uuid())`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE sales SET total=999 WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar ventas de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
