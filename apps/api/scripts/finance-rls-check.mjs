/**
 * Guardia RLS del libro mayor (F-1). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK) en el plan de cuentas
 * (chart_of_accounts) y en los asientos (journal_entries) y sus líneas (journal_lines). Corrige la
 * dispersa del schema sobre `app.current_tenant`. Self-contained.
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
  CREATE TABLE chart_of_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    code varchar(255) NOT NULL, name varchar(255) NOT NULL, type varchar(255) NOT NULL DEFAULT 'asset',
    is_postable boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE journal_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
    entry_date date NOT NULL DEFAULT now(), currency varchar(3) NOT NULL DEFAULT 'USD', status varchar(255) NOT NULL DEFAULT 'posted',
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE journal_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, entry_id uuid NOT NULL,
    account_id uuid NOT NULL, debit numeric(16,2) NOT NULL DEFAULT 0, credit numeric(16,2) NOT NULL DEFAULT 0,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
`);

for (const tbl of ['chart_of_accounts', 'journal_entries', 'journal_lines']) {
  await db.exec(`
    ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${tbl}
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    GRANT SELECT, INSERT, UPDATE ON ${tbl} TO appuser;
  `);
}

const E = '11111111-1111-1111-1111-111111111111';
await db.exec(`
  INSERT INTO chart_of_accounts (tenant_id, company_id, code, name) VALUES ('${A}','${CO}','1.1','Caja A'), ('${B}','${CO}','1.1','Caja B');
  INSERT INTO journal_entries (id, tenant_id, company_id) VALUES ('${E}','${A}','${CO}'), (gen_random_uuid(),'${B}','${CO}');
  INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit) VALUES ('${A}','${E}',gen_random_uuid(),100), ('${B}',gen_random_uuid(),gen_random_uuid(),50);
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

console.log('── Guardia RLS del libro mayor (rol no-super) ──');

for (const tbl of ['chart_of_accounts', 'journal_entries', 'journal_lines']) {
  const aSees = await inCtx(A, () => db.query(`SELECT id FROM ${tbl}`));
  aSees.rows.length === 1 ? ok(`${tbl}: tenant A ve solo su fila`) : bad(`${tbl}: A debería ver 1`, JSON.stringify(aSees.rows));
}

try {
  await inCtx(A, () => db.query(`INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit) VALUES ($1, gen_random_uuid(), gen_random_uuid(), 999)`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE journal_entries SET status='hack' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar asientos de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
