/**
 * Guardia RLS de laboratorio (LAB-1): labs + lab_samples + lab_results. Verifica bajo rol NO-super
 * que la política estándar `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK).
 * Corrige la dispersa del schema sobre `app.current_tenant`. Self-contained.
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
  CREATE TABLE labs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name varchar(255) NOT NULL, deleted_at timestamptz);
  CREATE TABLE lab_samples (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, sample_type varchar(255) NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(), status varchar(255) NOT NULL DEFAULT 'collected', deleted_at timestamptz);
  CREATE TABLE lab_results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, sample_id uuid NOT NULL, test_code varchar(255) NOT NULL, deleted_at timestamptz);
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
`);

for (const t of ['labs', 'lab_samples', 'lab_results']) {
  await db.exec(`
    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${t}
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    GRANT SELECT, INSERT, UPDATE ON ${t} TO appuser;
  `);
}
await db.exec(`
  INSERT INTO labs (tenant_id, name) VALUES ('${A}', 'Lab A'), ('${B}', 'Lab B');
  INSERT INTO lab_samples (tenant_id, sample_type) VALUES ('${A}', 'blood'), ('${B}', 'milk');
  INSERT INTO lab_results (tenant_id, sample_id, test_code) VALUES ('${A}', gen_random_uuid(), 'HB'), ('${B}', gen_random_uuid(), 'GLU');
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

console.log('── Guardia RLS de laboratorio (rol no-super) ──');

for (const t of ['labs', 'lab_samples', 'lab_results']) {
  const aSees = await inCtx(A, () => db.query(`SELECT id FROM ${t}`));
  aSees.rows.length === 1 ? ok(`${t}: tenant A ve solo lo suyo`) : bad(`${t}: A debería ver 1`, JSON.stringify(aSees.rows));
}
try {
  await inCtx(A, () => db.query(`INSERT INTO labs (tenant_id, name) VALUES ($1, 'hack')`, [B]));
  bad('WITH CHECK debería bloquear insertar a nombre de B');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE lab_samples SET status='rejected' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar muestras de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
