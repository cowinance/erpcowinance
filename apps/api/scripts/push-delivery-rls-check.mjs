/**
 * Guardia RLS del reclamo de entregas push (P7-3.b). Verifica, bajo un rol NO-superusuario
 * (como producción; PGlite dev corre como superusuario y saltea RLS — ver memoria), la
 * política bespoke de `notification_deliveries` (tenant + excepción `app.job_scope='push_worker'`):
 *   - un request normal (tenant, sin job_scope) NUNCA ve deliveries de otro tenant;
 *   - con app.job_scope='push_worker' la tx de reclamo ve deliveries cross-tenant;
 *   - el reclamo (FOR UPDATE SKIP LOCKED) devuelve SOLO id+tenant_id+notification_id;
 *   - al CERRAR esa tx el bypass DESAPARECE (SET LOCAL es scope de transacción).
 *
 * Self-contained (no requiere la API). El SQL del reclamo es idéntico a
 * PushDeliveryClaimRepository.claimBatch.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DUMMY = '00000000-0000-0000-0000-000000000000';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE TABLE notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, notification_id uuid NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'queued', next_attempt_at timestamptz, processing_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON notification_deliveries
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_scope', true) = 'push_worker')
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_scope', true) = 'push_worker');
  INSERT INTO notification_deliveries (id, tenant_id, notification_id, status) VALUES
    ('0000000a-0000-0000-0000-00000000000a', '${A}', '1111111a-0000-0000-0000-00000000000a', 'queued'),
    ('0000000b-0000-0000-0000-00000000000b', '${B}', '1111111b-0000-0000-0000-00000000000b', 'queued');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO appuser;
`);

async function inCtx({ tenant, job }, fn) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE appuser');
    if (tenant) await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    if (job) await db.query(`SELECT set_config('app.job_scope', $1, true)`, [job]);
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

// SQL del reclamo — IDÉNTICO a PushDeliveryClaimRepository.claimBatch.
const CLAIM = `
  UPDATE notification_deliveries SET processing_at=now(), updated_at=now()
  WHERE id IN (
    SELECT id FROM notification_deliveries
    WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')
    ORDER BY next_attempt_at NULLS FIRST, created_at
    FOR UPDATE SKIP LOCKED LIMIT 50
  )
  RETURNING id, tenant_id, notification_id`;

console.log('── Guardia RLS del reclamo de push (rol no-super) ──');

// 1/5. Request normal: cada tenant ve SOLO lo suyo.
const aSees = await inCtx({ tenant: A }, () => db.query('SELECT id FROM notification_deliveries'));
ok(`tenant A (sin job_scope) ve solo su delivery (${aSees.rows.length})`);
if (aSees.rows.length !== 1) bad('A debería ver 1', JSON.stringify(aSees.rows));
const bSees = await inCtx({ tenant: B }, () => db.query('SELECT id FROM notification_deliveries WHERE id=$1', ['0000000a-0000-0000-0000-00000000000a']));
ok(`tenant B NO ve la delivery de A (${bSees.rows.length})`);
if (bSees.rows.length !== 0) bad('B no debería ver la de A');

// 2. Descubrimiento cross-tenant con job_scope.
const disc = await inCtx({ tenant: DUMMY, job: 'push_worker' }, () => db.query('SELECT id FROM notification_deliveries ORDER BY id'));
ok(`worker (push_worker) descubre deliveries cross-tenant (${disc.rows.length})`);
if (disc.rows.length !== 2) bad('worker debería ver 2', JSON.stringify(disc.rows));

// 3. Reclamo: devuelve SOLO id+tenant_id+notification_id.
const claimed = await inCtx({ tenant: DUMMY, job: 'push_worker' }, () => db.query(CLAIM));
ok(`reclamo devuelve ${claimed.rows.length} delivery(s)`);
if (claimed.rows.length !== 2) bad('el reclamo debería tomar las 2', JSON.stringify(claimed.rows));
const keys = Object.keys(claimed.rows[0] ?? {}).sort();
ok(`reclamo devuelve solo id+notification_id+tenant_id (${keys.join('+')})`);
if (keys.join(',') !== 'id,notification_id,tenant_id') bad('debe devolver SOLO esos 3 campos', JSON.stringify(keys));

// 4. El bypass DESAPARECE al cerrar la tx: A (sin job_scope) sigue viendo solo lo suyo; no ve la de B.
const afterA = await inCtx({ tenant: A }, () => db.query('SELECT id FROM notification_deliveries'));
ok(`tras cerrar el reclamo, A (sin job_scope) sigue aislado (${afterA.rows.length})`);
if (afterA.rows.length !== 1) bad('A debería ver 1 (bypass no persiste)');
const afterCross = await inCtx({ tenant: A }, () => db.query('SELECT id FROM notification_deliveries WHERE id=$1', ['0000000b-0000-0000-0000-00000000000b']));
ok(`A NO ve la delivery de B tras el reclamo (${afterCross.rows.length})`);
if (afterCross.rows.length !== 0) bad('A no debería ver la de B');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
