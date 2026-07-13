/**
 * Guardia RLS del kardex (INV-2a). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla `stock_movements` (representativa; misma policy en
 * stock_levels). Corrige la dispersa del schema sobre `app.current_tenant`.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const X = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pass = 0,
  fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE stock_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, item_id uuid NOT NULL,
    warehouse_id uuid NOT NULL, movement_type varchar(32) NOT NULL, quantity numeric(14,3) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON stock_movements
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity) VALUES
    ('${A}','${X}','${X}','in',10), ('${B}','${X}','${X}','in',20);
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON stock_movements TO appuser;
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

console.log('── Guardia RLS de stock_movements (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT quantity FROM stock_movements'));
aSees.rows.length === 1 ? ok('tenant A ve solo su movimiento') : bad('A debería ver 1', JSON.stringify(aSees.rows));
const bSees = await inCtx(B, () => db.query('SELECT quantity FROM stock_movements'));
bSees.rows.length === 1 ? ok('tenant B ve solo su movimiento') : bad('B debería ver 1');

try {
  await inCtx(A, () => db.query(`INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity) VALUES ($1,$2,$3,'in',1)`, [B, X, X]));
  bad('A NO debería insertar a nombre de B (WITH CHECK)');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE stock_movements SET quantity=999 WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar el movimiento de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
