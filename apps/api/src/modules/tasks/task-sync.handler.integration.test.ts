import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Op } from '@cowinance/sync-core';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { SyncConflictWriter } from '../sync/registry/sync-conflict.writer';
import { SyncHandlerRegistry } from '../sync/registry/sync-handler.registry';
import { TaskService } from './task.service';
import { TaskSyncHandler } from './task-sync.handler';

/**
 * Integración del canal sync ENTRANTE de tareas (P6-1.b.1): un `put` de `tasks` pasa por la
 * regla única `TaskService` (origin='sync'), sin server-origin. Crear sanea (fuerza
 * general/pending, ignora reservados); completar conserva el completed_at del device;
 * done→done no-op; transición/cambio no soportado y completar sin completed_at → conflicto.
 */
describe('TaskSyncHandler · integración', () => {
  let db: DbService;
  let handler: TaskSyncHandler;
  let tenantId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const HLC = '00000000000100:000000:mobile';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'task-sync-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    handler = new TaskSyncHandler(db, new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), new SyncConflictWriter(db), new SyncHandlerRegistry());
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  // Un changeset real (server-origin) para satisfacer la FK de sync_conflicts.changeset_id.
  const newChangeset = async () =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO sync_changesets (tenant_id, source, origin_ref, hlc, operations, status, received_at, applied_at)
         VALUES ($1,'server',$2,'0',$3,'applied',now(),now()) RETURNING id`,
        [tenantId, `test-cs-${Date.now()}-${seq++}`, JSON.stringify({ client_id: 't', schema_version: 1, ops: [] })],
      )
    )[0].id;
  const put = (rowId: string, fields: Record<string, unknown>): Op => ({ kind: 'put', table: 'tasks', rowId, fields, hlc: HLC });
  const taskRow = async (id: string) => (await db.query<any>(`SELECT status, type, related_id, completed_at, title, priority FROM tasks WHERE id = $1`, [id]))[0];
  const changesets = async (ref: string) => db.query<any>(`SELECT id FROM sync_changesets WHERE source='server' AND origin_ref=$1`, [ref]);
  const apply = async (op: Op) => {
    const cs = await newChangeset();
    return db.tx((q) => handler.apply(q, op, cs));
  };

  it('crear: put sin fila → tarea pending/general; ignora reservados; sin server-origin', async () => {
    const id = randomUUID();
    const conflicts = await apply(put(id, { title: 'Reparar bebedero', priority: 'high', type: 'health', related_type: 'animal', related_id: randomUUID() }));
    expect(conflicts).toEqual([]);
    const r = await taskRow(id);
    expect({ status: r.status, type: r.type, related_id: r.related_id, title: r.title, priority: r.priority }).toEqual({
      status: 'pending',
      type: 'general', // reservado ignorado
      related_id: null, // reservado ignorado
      title: 'Reparar bebedero',
      priority: 'high',
    });
    // Sin eco server-origin (D2).
    expect(await changesets(`task:create:${id}`)).toHaveLength(0);
  });

  it('crear sin título → conflicto task.missing_title, sin fila', async () => {
    const id = randomUUID();
    const conflicts = await apply(put(id, { priority: 'normal' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('task.missing_title');
    expect(await taskRow(id)).toBeUndefined();
  });

  it('completar: put status=done + completed_at → done conservando el instante del device; sin eco', async () => {
    const id = randomUUID();
    await apply(put(id, { title: 'Completar por sync' }));
    const at = '2026-07-11T09:15:00.000Z';
    const conflicts = await apply(put(id, { status: 'done', completed_at: at }));
    expect(conflicts).toEqual([]);
    const r = await taskRow(id);
    expect(r.status).toBe('done');
    expect(new Date(r.completed_at).toISOString()).toBe(at);
    expect(await changesets(`task:complete:${id}`)).toHaveLength(0);
  });

  it('completar dos veces (done→done) es no-op sin conflicto', async () => {
    const id = randomUUID();
    await apply(put(id, { title: 'Doble' }));
    await apply(put(id, { status: 'done', completed_at: '2026-07-11T10:00:00.000Z' }));
    const again = await apply(put(id, { status: 'done', completed_at: '2026-07-11T11:00:00.000Z' }));
    expect(again).toEqual([]);
    expect((await taskRow(id)).status).toBe('done');
  });

  it('completar sin completed_at → conflicto task.complete_missing_at (sin cambiar estado)', async () => {
    const id = randomUUID();
    await apply(put(id, { title: 'Sin fecha' }));
    const conflicts = await apply(put(id, { status: 'done' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('task.complete_missing_at');
    expect((await taskRow(id)).status).toBe('pending');
  });

  it('cambio no soportado (edición de título en fila existente) → conflicto', async () => {
    const id = randomUUID();
    await apply(put(id, { title: 'Original' }));
    const conflicts = await apply(put(id, { title: 'Editado' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('task.unsupported_change');
    expect((await taskRow(id)).title).toBe('Original');
  });

  it('transición inválida (canceled→done) → conflicto task.invalid_transition', async () => {
    const id = randomUUID();
    await apply(put(id, { title: 'A cancelar' }));
    await db.query(`UPDATE tasks SET status='canceled' WHERE id=$1`, [id]);
    const conflicts = await apply(put(id, { status: 'done', completed_at: '2026-07-11T12:00:00.000Z' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('task.invalid_transition');
  });

  it('reaplicar un put de creación sobre fila existente no duplica (2da vez → conflicto)', async () => {
    const id = randomUUID();
    const first = await apply(put(id, { title: 'Única sync' }));
    expect(first).toEqual([]);
    // La 2da vez la fila ya existe y el put no es pending→done → cambio no soportado.
    const second = await apply(put(id, { title: 'Única sync' }));
    expect(second).toHaveLength(1);
    expect(second[0].detail).toContain('task.unsupported_change');
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE id = $1`, [id]))[0].n;
    expect(n).toBe(1);
  });
});
