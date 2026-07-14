/**
 * Guardia RLS de certifications (T-2). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige la dispersa del
 * schema sobre `app.current_tenant`. Self-contained.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EN = '11111111-1111-1111-1111-111111111111';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE certifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, entity_type varchar(255) NOT NULL DEFAULT 'farm',
    entity_id uuid NOT NULL, scheme varchar(255) NOT NULL, status varchar(255) NOT NULL DEFAULT 'active',
    valid_until date, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE certifications FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON certifications
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme) VALUES ('${A}','farm','${EN}','SENASA'), ('${B}','farm','${EN}','Orgánico');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON certifications TO appuser;
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

console.log('── Guardia RLS de certifications (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT scheme FROM certifications'));
aSees.rows.length === 1 ? ok('tenant A ve solo su certificación') : bad('A debería ver 1', JSON.stringify(aSees.rows));
try {
  await inCtx(A, () => db.query(`INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme) VALUES ($1,'farm',$2,'colada')`, [B, EN]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE certifications SET status='revoked' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar certificaciones de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
