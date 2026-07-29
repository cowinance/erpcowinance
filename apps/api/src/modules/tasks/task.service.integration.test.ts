import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { TaskService } from './task.service';
import { PlansService } from '../health/plans.service';

/**
 * Integración del núcleo neutral de tareas (P6-1.a) sobre PGlite aislado. Verifica el
 * contrato de estados restringido (pending; pending→done; done→done no-op; transición
 * inválida rechazada), la idempotencia de creación, la escritura de versiones LWW, el
 * server-origin SOLO cuando es server-authored, y la preservación del contrato sanitario
 * (Sanidad crea/completa vía la MISMA regla, sin duplicar).
 */
describe('TaskService · integración', () => {
  let db: DbService;
  let tasks: TaskService;
  let plans: PlansService;
  let tenantId: string;
  let userId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  const ctxRest = () => ({ origin: 'rest' as const, emitServerOrigin: true, actorUserId: userId });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'tasks-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    tasks = new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    plans = new PlansService(db, tasks);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const taskRow = async (id: string) => (await db.query<any>(`SELECT status, completed_at, type, title FROM tasks WHERE id = $1`, [id]))[0];
  const versions = async (id: string) =>
    (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='tasks' AND row_id=$1`, [id]))[0]?.versions;
  const changesets = async (ref: string) => db.query<any>(`SELECT operations FROM sync_changesets WHERE source='server' AND origin_ref=$1`, [ref]);

  it('createTask: fila pending, versiones LWW de todos los campos, y changeset server-origin', async () => {
    const res = await db.tx((q) => tasks.createTask(q, { title: '  Arreglar aguada  ', dueDate: '2026-07-20' }, ctxRest()));
    expect(res.taskId).toBeTruthy();
    const r = await taskRow(res.taskId);
    expect({ status: r.status, type: r.type, title: r.title }).toEqual({ status: 'pending', type: 'general', title: 'Arreglar aguada' });
    const v = await versions(res.taskId);
    expect(v.title).toBeTruthy();
    expect(v.status).toBeTruthy();
    expect(v.completed_at).toBeTruthy();
    const cs = await changesets(`task:create:${res.taskId}`);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0]).toMatchObject({ kind: 'put', table: 'tasks', rowId: res.taskId, fields: { status: 'pending' } });
  });

  it('createTask idempotente por id: reprocesar el mismo taskId no duplica', async () => {
    const id = randomUUID();
    await db.tx((q) => tasks.createTask(q, { taskId: id, title: 'Única' }, ctxRest()));
    await db.tx((q) => tasks.createTask(q, { taskId: id, title: 'Única' }, ctxRest()));
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE id = $1`, [id]))[0].n;
    expect(n).toBe(1);
  });

  it('createTask sin título → rechazo task.missing_title', async () => {
    await expect(db.tx((q) => tasks.createTask(q, { title: '   ' }, ctxRest()))).rejects.toMatchObject({ response: { code: 'task.missing_title' } });
  });

  it('completeTask: pending→done fija status+completed_at, versiona, y server-origin', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Completar' }, ctxRest()));
    const res = await db.tx((q) => tasks.completeTask(q, { taskId }, ctxRest()));
    expect(res).toMatchObject({ status: 'done', changed: true });
    const r = await taskRow(taskId);
    expect(r.status).toBe('done');
    expect(r.completed_at).toBeTruthy();
    const cs = await changesets(`task:complete:${taskId}`);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0].fields).toMatchObject({ status: 'done' });
  });

  it('completeTask idempotente: done→done es no-op (changed=false, sin re-emitir)', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Doble complete' }, ctxRest()));
    await db.tx((q) => tasks.completeTask(q, { taskId }, ctxRest()));
    const again = await db.tx((q) => tasks.completeTask(q, { taskId }, ctxRest()));
    expect(again).toMatchObject({ status: 'done', changed: false, syncOp: null });
  });

  it('completeTask conserva el completedAt provisto (semántica del device)', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Con fecha device' }, ctxRest()));
    const at = '2026-07-11T13:45:00.000Z';
    await db.tx((q) => tasks.completeTask(q, { taskId, completedAt: at }, { origin: 'sync', emitServerOrigin: false, actorUserId: userId, hlc: '00000000000100:000000:mobile' }));
    const r = await taskRow(taskId);
    expect(new Date(r.completed_at).toISOString()).toBe(at);
    // origin sync → sin eco server-origin.
    expect(await changesets(`task:complete:${taskId}`)).toHaveLength(0);
  });

  it('transición no contemplada en P6-1 (canceled→done) → rechazo task.invalid_transition', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Cancelada a mano' }, ctxRest()));
    await db.query(`UPDATE tasks SET status='canceled' WHERE id=$1`, [taskId]);
    await expect(db.tx((q) => tasks.completeTask(q, { taskId }, ctxRest()))).rejects.toMatchObject({ response: { code: 'task.invalid_transition' } });
  });

  it('completeTask sobre id inexistente → task.not_found', async () => {
    await expect(db.tx((q) => tasks.completeTask(q, { taskId: randomUUID() }, ctxRest()))).rejects.toMatchObject({ response: { code: 'task.not_found' } });
  });

  it('cancelTask: pending→canceled fija status, versiona, y server-origin', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'A cancelar' }, ctxRest()));
    const res = await db.tx((q) => tasks.cancelTask(q, { taskId }, ctxRest()));
    expect(res).toMatchObject({ status: 'canceled', changed: true });
    expect((await taskRow(taskId)).status).toBe('canceled');
    const cs = await changesets(`task:cancel:${taskId}`);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops[0].fields).toMatchObject({ status: 'canceled' });
  });

  it('cancelTask idempotente: canceled→canceled es no-op (changed=false, sin re-emitir)', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Doble cancel' }, ctxRest()));
    await db.tx((q) => tasks.cancelTask(q, { taskId }, ctxRest()));
    const again = await db.tx((q) => tasks.cancelTask(q, { taskId }, ctxRest()));
    expect(again).toMatchObject({ status: 'canceled', changed: false, syncOp: null });
  });

  it('cancelTask sobre una tarea completada (done) → rechazo task.invalid_transition', async () => {
    const { taskId } = await db.tx((q) => tasks.createTask(q, { title: 'Ya hecha' }, ctxRest()));
    await db.tx((q) => tasks.completeTask(q, { taskId }, ctxRest()));
    await expect(db.tx((q) => tasks.cancelTask(q, { taskId }, ctxRest()))).rejects.toMatchObject({ response: { code: 'task.invalid_transition' } });
  });

  it('cancelTask sobre id inexistente → task.not_found', async () => {
    await expect(db.tx((q) => tasks.cancelTask(q, { taskId: randomUUID() }, ctxRest()))).rejects.toMatchObject({ response: { code: 'task.not_found' } });
  });

  it('contrato sanitario preservado: PlansService.completeTask delega en la MISMA regla', async () => {
    // Una tarea de salud creada por la vía neutral (como lo hace ahora plans.apply).
    const { taskId } = await db.tx((q) =>
      tasks.createTask(q, { title: 'Vacuna — caravana 100', type: 'health', relatedType: 'animal', relatedId: randomUUID(), dueDate: '2026-07-15' }, { origin: 'health', emitServerOrigin: true, actorUserId: userId }),
    );
    const res = await plans.completeTask(taskId);
    expect(res).toEqual({ id: taskId, status: 'done' });
    expect((await taskRow(taskId)).status).toBe('done');
  });

  it('APLICAR UN PLAN DA CUENTA DE TODO LO QUE MIRÓ', async () => {
    // El resumen contestaba «65 animales · 0 tareas creadas · 34 salteadas», y las cuentas no
    // cerraban: 65 animales × 2 pasos son 130 combinaciones, y las 96 que el plan descartaba por
    // categoría se iban con un `continue` que no contaba nada. El productor no podía distinguir
    // «este plan no alcanza a estos animales» de «algo falló» — y un «0 creadas» se lee como error.
    const plan = (await db.query<{ id: string }>(
      `INSERT INTO health_plans (tenant_id, species_id, name, schedule, created_by) VALUES ($1,$4,'PLAN cuentas',$2::jsonb,$3) RETURNING id`,
      [tenantId, JSON.stringify([{ label: 'Solo terneros', offset_days: 7, applies_to: ['ternero'] }, { label: 'Todos', offset_days: 14 }]), userId, speciesId],
    ))[0].id;

    const r: any = await plans.apply(plan, {});
    expect(r.tasks_created + r.tasks_skipped + r.not_applicable, 'la cuenta tiene que cerrar').toBe(r.animals * r.steps);
    expect(r.detail).toHaveLength(2);

    // El paso sin `applies_to` alcanza a TODOS; el otro solo a los terneros.
    const todos = r.detail.find((d: any) => d.step === 'Todos');
    const soloTerneros = r.detail.find((d: any) => d.step === 'Solo terneros');
    expect(todos.targeted).toBe(r.animals);
    expect(soloTerneros.targeted).toBeLessThan(r.animals);
    expect(soloTerneros.targeted).toBeGreaterThan(0);
    expect(r.animals_targeted, 'los animales alcanzados son los del paso más amplio').toBe(r.animals);
  });

  it('un plan que NO ALCANZA A NADIE lo dice, en vez de contestar cero', async () => {
    // Es el caso que se leía como falla. Ahora `targeted` en cero es la señal de que el plan no
    // aplica a lo elegido, y `detail` trae a qué categorías sí — que es lo que el productor necesita
    // para saber qué hacer.
    const plan = (await db.query<{ id: string }>(
      `INSERT INTO health_plans (tenant_id, species_id, name, schedule, created_by) VALUES ($1,$4,'PLAN vacío',$2::jsonb,$3) RETURNING id`,
      [tenantId, JSON.stringify([{ label: 'Para una categoría que nadie tiene', offset_days: 1, applies_to: ['categoria_inexistente'] }]), userId, speciesId],
    ))[0].id;

    const r: any = await plans.apply(plan, {});
    expect(r.targeted).toBe(0);
    expect(r.animals_targeted).toBe(0);
    expect(r.tasks_created).toBe(0);
    expect(r.not_applicable, 'todas las combinaciones quedaron afuera, y se cuentan').toBe(r.animals * r.steps);
    expect(r.detail[0].applies_to).toEqual(['categoria_inexistente']);
  });

  it('reaplicar el mismo plan no crea de nuevo, y lo dice como salteadas', async () => {
    const plan = (await db.query<{ id: string }>(
      `INSERT INTO health_plans (tenant_id, species_id, name, schedule, created_by) VALUES ($1,$4,'PLAN repetido',$2::jsonb,$3) RETURNING id`,
      [tenantId, JSON.stringify([{ label: 'Paso único', offset_days: 3 }]), userId, speciesId],
    ))[0].id;

    const a: any = await plans.apply(plan, { anchor_date: '2026-06-01' });
    expect(a.tasks_created).toBeGreaterThan(0);
    const b: any = await plans.apply(plan, { anchor_date: '2026-06-01' });
    expect(b.tasks_created).toBe(0);
    expect(b.tasks_skipped).toBe(a.tasks_created);
    expect(b.tasks_created + b.tasks_skipped + b.not_applicable).toBe(b.animals * b.steps);
  });
});
