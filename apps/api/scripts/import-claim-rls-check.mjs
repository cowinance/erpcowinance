/**
 * Guardia RLS del reclamo de importación (P2 P-c.1). Verifica, bajo un rol
 * NO-superusuario (como producción; PGlite dev corre como superusuario y saltea
 * RLS — ver docs/adr y memoria), la excepción de descubrimiento `app.job_scope`
 * y su aislamiento:
 *   - un request normal (tenant, sin job_scope) NUNCA ve batches de otro tenant;
 *   - con app.job_scope='import_worker' la tx de reclamo ve batches cross-tenant;
 *   - al CERRAR esa tx el bypass DESAPARECE (SET LOCAL es scope de transacción);
 *   - el reclamo (FOR UPDATE SKIP LOCKED, RETURNING id, tenant_id) transiciona
 *     un batch a 'processing' y devuelve solo id+tenant.
 *
 * Self-contained (no requiere la API). El SQL del reclamo se mantiene idéntico a
 * ImportClaimRepository.claimNext.
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

// Tabla mínima + política bespoke de import_batches (tenant + excepción job_scope) + FORCE.
await db.exec(`
  CREATE TABLE import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'uploaded', phase varchar(16),
    heartbeat_at timestamptz, started_at timestamptz, file_ref varchar(255),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON import_batches
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_scope', true) = 'import_worker')
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_scope', true) = 'import_worker');
  INSERT INTO import_batches (id, tenant_id, status) VALUES
    ('0000000a-0000-0000-0000-00000000000a', '${A}', 'queued'),
    ('0000000b-0000-0000-0000-00000000000b', '${B}', 'queued');
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='appuser') THEN CREATE ROLE appuser NOSUPERUSER; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO appuser;
  GRANT SELECT, INSERT, UPDATE ON import_batches TO appuser;
`);

// Cada contexto: tx con SET LOCAL ROLE (no-super) + SET LOCAL app.* (como el worker/interceptor real).
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

// SQL del reclamo — IDÉNTICO a ImportClaimRepository.claimNext.
const CLAIM = `
  UPDATE import_batches
     SET status='processing', phase='create', heartbeat_at=now(),
         started_at=COALESCE(started_at, now()), updated_at=now()
   WHERE id = (
     SELECT id FROM import_batches
     WHERE status='queued' OR (status='processing' AND heartbeat_at < now() - interval '2 minutes')
     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
   )
   RETURNING id, tenant_id`;

console.log('── Guardia RLS del reclamo de import (rol no-super) ──');

// 1. Request normal: cada tenant ve SOLO lo suyo (la política ampliada no filtra sin job_scope).
const aSees = await inCtx({ tenant: A }, () => db.query('SELECT id FROM import_batches'));
ok(`tenant A (sin job_scope) ve solo su batch (${aSees.rows.length})`);
if (aSees.rows.length !== 1) bad('A debería ver 1', JSON.stringify(aSees.rows));
const bSees = await inCtx({ tenant: B }, () => db.query('SELECT id FROM import_batches'));
ok(`tenant B (sin job_scope) ve solo su batch (${bSees.rows.length})`);
if (bSees.rows.length !== 1) bad('B debería ver 1');

// 2. Descubrimiento: con job_scope, la tx ve batches cross-tenant.
const disc = await inCtx({ tenant: DUMMY, job: 'import_worker' }, () => db.query('SELECT id, tenant_id FROM import_batches ORDER BY id'));
ok(`worker (job_scope) descubre batches cross-tenant (${disc.rows.length})`);
if (disc.rows.length !== 2) bad('worker debería ver 2', JSON.stringify(disc.rows));

// 3. Reclamo atómico: transiciona uno a processing y devuelve SOLO id+tenant_id.
const claimed = await inCtx({ tenant: DUMMY, job: 'import_worker' }, () => db.query(CLAIM));
const row = claimed.rows[0];
ok(`reclamo devuelve id+tenant_id (${row?.id ? 'sí' : 'no'})`);
if (!row?.id || !row?.tenant_id) bad('el reclamo debía devolver id y tenant_id', JSON.stringify(row));
if (Object.keys(row ?? {}).length !== 2) bad('el reclamo debe devolver SOLO id+tenant_id', JSON.stringify(row));
// el batch quedó processing (visible con job_scope)
const st = await inCtx({ tenant: DUMMY, job: 'import_worker' }, () => db.query('SELECT status, phase FROM import_batches WHERE id=$1', [row.id]));
ok(`batch reclamado → processing/create (${st.rows[0]?.status}/${st.rows[0]?.phase})`);
if (st.rows[0]?.status !== 'processing' || st.rows[0]?.phase !== 'create') bad('estado esperado processing/create');

// 4. El bypass DESAPARECE al cerrar la tx de reclamo: una tx nueva SIN job_scope vuelve a estar aislada.
const owner = row.tenant_id === A ? A : B;
const other = owner === A ? B : A;
const afterOwner = await inCtx({ tenant: owner }, () => db.query('SELECT id FROM import_batches'));
ok(`tras cerrar la tx de reclamo, el dueño (sin job_scope) sigue viendo solo lo suyo (${afterOwner.rows.length})`);
if (afterOwner.rows.length !== 1) bad('el dueño debería ver 1 (bypass no persiste)');
const afterOther = await inCtx({ tenant: other }, () => db.query('SELECT id FROM import_batches WHERE id=$1', [row.id]));
ok(`otro tenant NO ve el batch reclamado (${afterOther.rows.length})`);
if (afterOther.rows.length !== 0) bad('el otro tenant no debería ver el batch reclamado');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
