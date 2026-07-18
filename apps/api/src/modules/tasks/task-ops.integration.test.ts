import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { TaskService } from './task.service';

/**
 * Tareas → centro operativo E1: máquina de estados ampliada (in_progress), reprogramación,
 * asignación, historial (task_events) y campos de sync (assigned_to). Reusa TaskService.
 */
describe('TaskService · centro operativo (E1)', () => {
  let db: DbService;
  let tasks: TaskService;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  const ctx = () => ({ origin: 'rest' as const, emitServerOrigin: true, actorUserId: userId });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'taskops-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    tasks = new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const mk = async (over: any = {}) => (await db.tx((q) => tasks.createTask(q, { title: 'T', dueDate: '2026-08-01', ...over }, ctx()))).taskId;
  const row = async (id: string) => (await db.query<any>(`SELECT status, due_date::text AS due_date, assigned_to, completed_at FROM tasks WHERE id=$1`, [id]))[0];
  const events = async (id: string) => db.query<any>(`SELECT kind, from_value, to_value, note FROM task_events WHERE task_id=$1 ORDER BY occurred_at, created_at`, [id]);

  it('inicia una tarea: pending → in_progress (idempotente) + historial', async () => {
    const id = await mk();
    const r1 = await db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()));
    expect(r1.status).toBe('in_progress');
    expect(r1.changed).toBe(true);
    expect((await row(id)).status).toBe('in_progress');
    // Idempotente.
    const r2 = await db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()));
    expect(r2.changed).toBe(false);
    const ev = await events(id);
    expect(ev.map((e: any) => e.kind)).toEqual(['created', 'status_change']);
    expect(ev[1].to_value).toBe('in_progress');
  });

  it('completa desde in_progress; done es terminal (no se puede iniciar/cancelar)', async () => {
    const id = await mk();
    await db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()));
    const r = await db.tx((q) => tasks.completeTask(q, { taskId: id }, ctx()));
    expect(r.status).toBe('done');
    expect((await row(id)).completed_at).toBeTruthy();
    await expect(db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()))).rejects.toThrow();
    // cancelar una done → rechazo (terminal).
    await expect(db.tx((q) => tasks.cancelTask(q, { taskId: id }, ctx()))).rejects.toThrow();
  });

  it('cancela desde in_progress con motivo', async () => {
    const id = await mk();
    await db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()));
    const r = await db.tx((q) => tasks.cancelTask(q, { taskId: id, reason: 'ya no aplica' }, ctx()));
    expect(r.status).toBe('canceled');
    const ev = await events(id);
    expect(ev.at(-1).note).toBe('ya no aplica');
  });

  it('reprograma: cambia due_date, versiona, deja historial from/to; no-op si igual fecha', async () => {
    const id = await mk({ dueDate: '2026-08-01' });
    const r = await db.tx((q) => tasks.rescheduleTask(q, { taskId: id, dueDate: '2026-08-15', reason: 'lluvia' }, ctx()));
    expect(r.changed).toBe(true);
    expect((await row(id)).due_date).toContain('2026-08-15');
    const resched = (await events(id)).find((e: any) => e.kind === 'rescheduled');
    expect(resched.to_value).toContain('2026-08-15');
    expect(resched.note).toBe('lluvia');
    // No-op con la misma fecha.
    const r2 = await db.tx((q) => tasks.rescheduleTask(q, { taskId: id, dueDate: '2026-08-15' }, ctx()));
    expect(r2.changed).toBe(false);
    // versiona due_date en sync_row_state.
    const v = (await db.query<any>(`SELECT versions FROM sync_row_state WHERE table_name='tasks' AND row_id=$1`, [id]))[0].versions;
    expect(v.due_date).toBeTruthy();
  });

  it('no se puede reprogramar una tarea done', async () => {
    const id = await mk();
    await db.tx((q) => tasks.completeTask(q, { taskId: id }, ctx()));
    await expect(db.tx((q) => tasks.rescheduleTask(q, { taskId: id, dueDate: '2026-09-01' }, ctx()))).rejects.toThrow();
  });

  it('asigna a un usuario (valida existencia) y versiona assigned_to para sync', async () => {
    const id = await mk();
    const r = await db.tx((q) => tasks.assignTask(q, { taskId: id, assignedTo: userId }, ctx()));
    expect(r.changed).toBe(true);
    expect((await row(id)).assigned_to).toBe(userId);
    const v = (await db.query<any>(`SELECT versions FROM sync_row_state WHERE table_name='tasks' AND row_id=$1`, [id]))[0].versions;
    expect(v.assigned_to).toBeTruthy();
    // Usuario inexistente → rechazo.
    await expect(db.tx((q) => tasks.assignTask(q, { taskId: id, assignedTo: '00000000-0000-0000-0000-000000000000' }, ctx()))).rejects.toThrow();
    // Desasignar.
    const r2 = await db.tx((q) => tasks.assignTask(q, { taskId: id, assignedTo: null }, ctx()));
    expect(r2.changed).toBe(true);
    expect((await row(id)).assigned_to).toBeNull();
  });

  it('board: buckets derivados, días de atraso, filtros por bucket/responsable/búsqueda', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const overdueId = await mk({ title: 'Revisar aguada vencida', dueDate: past });
    const todayId = await mk({ title: 'Vacunar hoy', dueDate: today });
    await mk({ title: 'Mover lote pronto', dueDate: soon });
    const mineId = await mk({ title: 'Asignada a mí', dueDate: today, assignedTo: userId });

    const all = await tasks.board();
    const byId = Object.fromEntries(all.map((r: any) => [r.id, r]));
    expect(byId[overdueId].bucket).toBe('overdue');
    expect(byId[overdueId].days_overdue).toBeGreaterThanOrEqual(4);
    expect(byId[todayId].bucket).toBe('today');

    // Filtro por bucket.
    const overdueOnly = await tasks.board({ bucket: 'overdue' });
    expect(overdueOnly.every((r: any) => r.bucket === 'overdue')).toBe(true);
    expect(overdueOnly.some((r: any) => r.id === overdueId)).toBe(true);

    // Filtro "asignadas a mí".
    const mine = await tasks.board({ assignedTo: 'me' });
    expect(mine.some((r: any) => r.id === mineId)).toBe(true);
    expect(mine.every((r: any) => r.assignee_name)).toBe(true);

    // Búsqueda por título.
    const found = await tasks.board({ q: 'aguada' });
    expect(found.some((r: any) => r.id === overdueId)).toBe(true);
    expect(found.some((r: any) => r.id === todayId)).toBe(false);
  });

  it('kpis: vencidas, completadas, cumplimiento, carga por responsable y módulo', async () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await mk({ title: 'KPI vencida crítica', dueDate: past, priority: 'urgent' });
    const doneId = await mk({ title: 'KPI a completar', dueDate: new Date().toISOString().slice(0, 10) });
    await db.tx((q) => tasks.completeTask(q, { taskId: doneId }, ctx()));

    const k: any = await tasks.kpis();
    expect(k.overdue).toBeGreaterThanOrEqual(1);
    expect(k.critical_overdue).toBeGreaterThanOrEqual(1);
    expect(k.done_today).toBeGreaterThanOrEqual(1);
    expect(k.compliance_pct).not.toBeNull();
    expect(Array.isArray(k.by_assignee)).toBe(true);
    expect(Array.isArray(k.by_module)).toBe(true);
    expect(Array.isArray(k.weekly_trend)).toBe(true);
  });
});
