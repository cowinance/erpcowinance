/**
 * Guardia RLS del inventario (INV-1). Verifica bajo rol NO-super que la política estándar
 * `tenant_isolation` sobre `app.tenant_id` aísla `inventory_items` (representativa; misma policy en
 * inventory_categories y warehouses). Corrige la dispersa del schema sobre `app.current_tenant`.
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
  CREATE TABLE inventory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name varchar(255) NOT NULL,
    unit varchar(255) NOT NULL DEFAULT 'un', is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON inventory_items
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  INSERT INTO inventory_items (tenant_id, name) VALUES ('${A}','Maíz A'), ('${B}','Maíz B');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON inventory_items TO appuser;
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

console.log('── Guardia RLS de inventory_items (rol no-super) ──');

const aSees = await inCtx(A, () => db.query('SELECT name FROM inventory_items'));
aSees.rows.length === 1 && aSees.rows[0].name === 'Maíz A' ? ok('tenant A ve solo su ítem') : bad('A debería ver solo Maíz A', JSON.stringify(aSees.rows));
const bSees = await inCtx(B, () => db.query('SELECT name FROM inventory_items'));
bSees.rows.length === 1 && bSees.rows[0].name === 'Maíz B' ? ok('tenant B ve solo su ítem') : bad('B debería ver solo Maíz B');

try {
  await inCtx(A, () => db.query(`INSERT INTO inventory_items (tenant_id, name) VALUES ($1,'colado')`, [B]));
  bad('A NO debería insertar a nombre de B (WITH CHECK)');
} catch {
  ok('WITH CHECK bloquea insertar a nombre de otro tenant');
}
const upd = await inCtx(A, () => db.query(`UPDATE inventory_items SET name='hackeado' WHERE tenant_id=$1 RETURNING id`, [B]));
upd.rows.length === 0 ? ok('A no puede modificar el ítem de B') : bad('A no debería tocar filas de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
