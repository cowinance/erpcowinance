/**
 * Guardia RLS de repro_protocol_assignments (R-2.b.1). Verifica bajo rol NO-super (como prod) que
 * la política estándar `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert y que el
 * WITH CHECK impide insertar a nombre de otro tenant. Self-contained (no requiere la API).
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const P = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE repro_protocol_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
    protocol_id uuid NOT NULL, lot_id uuid, start_date date NOT NULL,
    animal_count int NOT NULL DEFAULT 0, status varchar(16) NOT NULL DEFAULT 'active',
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE repro_protocol_assignments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE repro_protocol_assignments FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON repro_protocol_assignments
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, start_date) VALUES
    ('${A}', '${P}', '2027-01-01'), ('${B}', '${P}', '2027-02-01');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON repro_protocol_assignments TO appuser;
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

console.log('── Guardia RLS de repro_protocol_assignments (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT id FROM repro_protocol_assignments'));
aSees.rows.length === 1 ? ok('tenant A ve solo su asignación') : bad('A debería ver 1', JSON.stringify(aSees.rows));
const bSees = await inCtx(B, () => db.query('SELECT id FROM repro_protocol_assignments'));
bSees.rows.length === 1 ? ok('tenant B ve solo su asignación') : bad('B debería ver 1');

try {
  await inCtx(A, () => db.query(`INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, start_date) VALUES ($1,$2,'2027-03-01')`, [A, P]));
  ok('tenant A inserta una asignación propia');
} catch (e) {
  bad('A debería poder insertar lo suyo', e.message);
}
try {
  await inCtx(A, () => db.query(`INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, start_date) VALUES ($1,$2,'2027-03-01')`, [B, P]));
  bad('A NO debería insertar a nombre de B (WITH CHECK)');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE repro_protocol_assignments SET status='canceled' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede cancelar la asignación de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
