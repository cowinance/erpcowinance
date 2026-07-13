/**
 * Guardia RLS de invoices (F-3a). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige la dispersa del
 * schema sobre `app.current_tenant`. Self-contained.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CO = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const P = '11111111-1111-1111-1111-111111111111';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    direction varchar(255) NOT NULL DEFAULT 'issued', partner_id uuid NOT NULL, invoice_number varchar(255) NOT NULL,
    issue_date date NOT NULL DEFAULT now(), currency varchar(3) NOT NULL DEFAULT 'ARS', total numeric(16,2) NOT NULL DEFAULT 0,
    status varchar(255) NOT NULL DEFAULT 'issued', deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
  ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON invoices
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO invoices (tenant_id, company_id, partner_id, invoice_number, total) VALUES ('${A}','${CO}','${P}','A-1',100), ('${B}','${CO}','${P}','B-1',200);
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON invoices TO appuser;
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

console.log('── Guardia RLS de invoices (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT invoice_number FROM invoices'));
aSees.rows.length === 1 ? ok('tenant A ve solo su factura') : bad('A debería ver 1', JSON.stringify(aSees.rows));
try {
  await inCtx(A, () => db.query(`INSERT INTO invoices (tenant_id, company_id, partner_id, invoice_number) VALUES ($1,$2,$3,'colada')`, [B, CO, P]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE invoices SET status='hack' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar facturas de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
