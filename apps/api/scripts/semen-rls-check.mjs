/**
 * Guardia RLS de semen_batches (G-1). Verifica bajo rol NO-super que la política estándar
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
  CREATE TABLE semen_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, batch_code varchar(255) NOT NULL,
    straws_available integer NOT NULL DEFAULT 0, sire_name_external varchar(255), deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE semen_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE semen_batches FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON semen_batches
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO semen_batches (tenant_id, batch_code, straws_available) VALUES ('${A}','LOTE-A',20), ('${B}','LOTE-B',30);
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON semen_batches TO appuser;
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

console.log('── Guardia RLS de semen_batches (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT batch_code FROM semen_batches'));
aSees.rows.length === 1 ? ok('tenant A ve solo su partida') : bad('A debería ver 1', JSON.stringify(aSees.rows));
try {
  await inCtx(A, () => db.query(`INSERT INTO semen_batches (tenant_id, batch_code) VALUES ($1,'colada')`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE semen_batches SET straws_available=0 WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar partidas de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
