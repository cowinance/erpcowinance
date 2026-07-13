/**
 * Guardia RLS de subscriptions (B-1). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla lectura/insert (WITH CHECK). Corrige la policy
 * dispersa del schema sobre `app.current_tenant` (que la app nunca setea). Self-contained.
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
  CREATE TABLE subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, plan_id uuid NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'trialing', billing_currency varchar(3) NOT NULL DEFAULT 'USD',
    current_period_start date NOT NULL DEFAULT CURRENT_DATE, current_period_end date NOT NULL DEFAULT CURRENT_DATE,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON subscriptions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO subscriptions (tenant_id, plan_id) VALUES ('${A}','${P}'), ('${B}','${P}');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON subscriptions TO appuser;
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

console.log('── Guardia RLS de subscriptions (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT id FROM subscriptions'));
aSees.rows.length === 1 ? ok('tenant A ve solo su suscripción') : bad('A debería ver 1', JSON.stringify(aSees.rows));
const bSees = await inCtx(B, () => db.query('SELECT id FROM subscriptions'));
bSees.rows.length === 1 ? ok('tenant B ve solo su suscripción') : bad('B debería ver 1');

try {
  await inCtx(A, () => db.query(`INSERT INTO subscriptions (tenant_id, plan_id) VALUES ($1,$2)`, [B, P]));
  bad('A NO debería insertar a nombre de B (WITH CHECK)');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE subscriptions SET status='canceled' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar la suscripción de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
