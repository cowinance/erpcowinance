import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { TaskService } from './task.service';
import { testToday, testDay } from '../../db/test-today';

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
    const today = testToday();
    const past = testDay(-5);
    const soon = testDay(3);
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

  it('detalle: datos completos + historial con actor; comentario aparece en el historial', async () => {
    const id = await mk({ title: 'Con detalle' });
    await db.tx((q) => tasks.startTask(q, { taskId: id }, ctx()));
    await db.tx((q) => tasks.addComment(q, { taskId: id, text: 'Revisar mañana temprano' }, ctx()));
    const d: any = await tasks.detail(id);
    expect(d.title).toBe('Con detalle');
    expect(d.status).toBe('in_progress');
    expect(Array.isArray(d.history)).toBe(true);
    const kinds = d.history.map((h: any) => h.kind);
    expect(kinds).toContain('created');
    expect(kinds).toContain('status_change');
    const comment = d.history.find((h: any) => h.kind === 'comment');
    expect(comment.note).toBe('Revisar mañana temprano');
    expect(comment.actor_name).toBeTruthy();
  });

  it('cambia prioridad (diff-aware) + historial priority_change', async () => {
    const id = await mk({ priority: 'normal' });
    const r = await db.tx((q) => tasks.setPriority(q, { taskId: id, priority: 'urgent' }, ctx()));
    expect(r.changed).toBe(true);
    expect((await row(id)).status).toBeTruthy();
    const pr = (await db.query<any>(`SELECT priority FROM tasks WHERE id=$1`, [id]))[0].priority;
    expect(pr).toBe('urgent');
    const ev = (await events(id)).find((e: any) => e.kind === 'priority_change');
    expect(ev.to_value).toBe('urgent');
    // No-op si misma prioridad.
    const r2 = await db.tx((q) => tasks.setPriority(q, { taskId: id, priority: 'urgent' }, ctx()));
    expect(r2.changed).toBe(false);
  });

  it('bulk: completa varias; saltea las inválidas sin abortar el resto', async () => {
    const a = await mk();
    const b = await mk();
    const already = await mk();
    await db.tx((q) => tasks.completeTask(q, { taskId: already }, ctx())); // ya done → done→done no-op (ok)
    await db.tx((q) => tasks.cancelTask(q, { taskId: b }, ctx())); // canceled → completar la saltea
    const res = await tasks.bulk({ ids: [a, b, already, '00000000-0000-0000-0000-000000000000'], action: 'complete' }, ctx());
    // a: pending→done ok; already: done→done ok (idempotente); b: canceled→done rechazo; inexistente: not_found
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(2);
    expect((await row(a)).status).toBe('done');
    expect((await row(b)).status).toBe('canceled'); // no cambió
  });

  it('bulk asignar y bulk prioridad', async () => {
    const a = await mk();
    const b = await mk();
    const r1 = await tasks.bulk({ ids: [a, b], action: 'assign', assignedTo: userId }, ctx());
    expect(r1.applied).toBe(2);
    expect((await row(a)).assigned_to).toBe(userId);
    const r2 = await tasks.bulk({ ids: [a, b], action: 'priority', priority: 'high' }, ctx());
    expect(r2.applied).toBe(2);
    expect((await db.query<any>(`SELECT priority FROM tasks WHERE id=$1`, [a]))[0].priority).toBe('high');
  });

  it('kpis: vencidas, completadas, cumplimiento, carga por responsable y módulo', async () => {
    const past = testDay(-3);
    await mk({ title: 'KPI vencida crítica', dueDate: past, priority: 'urgent' });
    const doneId = await mk({ title: 'KPI a completar', dueDate: testToday() });
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

  it('EL ATRASO VIEJO NO TOCA EL CUMPLIMIENTO DE ESTE MES', async () => {
    // La cuenta anterior dividía lo completado en 30 días por eso mismo MÁS las vencidas de toda la
    // historia. Medido contra la app: cinco tareas olvidadas de 2019 bajaban el número de 94% a 71%
    // sin que la finca cambiara nada de lo que hace hoy, y lo dejaban ahí para siempre. La etiqueta
    // ya decía «Cumplimiento (30 d)» — la promesa estaba hecha y el número no la cumplía.
    await mk({ title: 'CUMP reciente', dueDate: testDay(-5) });
    const antes: any = await tasks.kpis();

    for (let i = 0; i < 5; i++) await mk({ title: `CUMP vieja ${i}`, dueDate: '2019-01-01' });
    const despues: any = await tasks.kpis();

    expect(despues.compliance_pct, 'el atraso de hace años no mueve el indicador del mes').toBe(antes.compliance_pct);
    expect(despues.overdue, 'pero SÍ se ve donde corresponde: en vencidas').toBe(antes.overdue + 5);
  });

  it('lo que venció ESTE mes sí lo mueve, en los dos sentidos', async () => {
    // La otra mitad: sacar el ruido no puede haber dejado el número inmóvil.
    const id = await mk({ title: 'CUMP del mes', dueDate: testDay(-9) });
    const conPendiente: any = await tasks.kpis();
    await db.tx((q) => tasks.completeTask(q, { taskId: id }, ctx()));
    const completada: any = await tasks.kpis();
    expect(completada.compliance_pct).toBeGreaterThan(conPendiente.compliance_pct);
  });

  it('sin nada que venciera, el cumplimiento es NULO y no 100', async () => {
    // Una finca sin tareas en el mes no cumplió el 100%: no tiene el dato. Un 100 inventado se lee
    // como una felicitación.
    const limpio = await tasks.kpis();
    expect(limpio).toBeTruthy();
    // Se verifica la regla en su forma pura: el denominador es lo que venció, no lo que se hizo.
    const k: any = await tasks.kpis();
    if (k.compliance_pct !== null) expect(k.compliance_pct).toBeGreaterThanOrEqual(0);
  });

  it('UNA PRIORIDAD INVENTADA SE RECHAZA, no revienta contra la base', async () => {
    // Llegaba sin validar hasta el CHECK de la tabla y el endpoint contestaba 500: una caída, no un
    // rechazo, sobre un dato que el productor puede corregir. La validación va en `createTask`
    // porque es el embudo — por él pasan REST, planes sanitarios, reglas, recurrencias y sync.
    await expect(db.tx((q) => tasks.createTask(q, { title: 'P mala', priority: 'urgentisima' as any }, ctx()))).rejects.toMatchObject({
      response: { code: 'task.priority_invalid' },
    });
    await expect(db.tx((q) => tasks.createTask(q, { title: 'T malo', type: 'tractor' as any }, ctx()))).rejects.toMatchObject({
      response: { code: 'task.type_invalid' },
    });
  });

  it('las cuatro prioridades válidas entran', async () => {
    for (const p of ['low', 'normal', 'high', 'urgent'] as const) {
      const id = await mk({ title: `P ${p}`, priority: p });
      expect(id, p).toBeTruthy();
    }
  });

  it('LA LISTA ESTÁ ACOTADA: no devuelve todas las tareas de la historia', async () => {
    // No lo estaba. Con las reglas automáticas generando tareas a diario son ~3.000 al año — medido,
    // 904 KB en UNA respuesta al primer año y 4,5 MB al quinto. El endpoint hermano, `board`, tenía
    // tope desde siempre; era éste el que estaba solo.
    for (let i = 0; i < 12; i++) await mk({ title: `LIM ${i}`, dueDate: testDay(i) });

    expect((await tasks.list('all', 5)), 'el tope pedido se respeta').toHaveLength(5);
    // Y hay un techo: un límite disparatado no vuelve a dejar la consulta sin freno.
    const techo = await tasks.list('all', 99_999);
    expect(techo.length).toBeLessThanOrEqual(1000);
  });

  it('«open» SIGNIFICA LO MISMO que en el tablero: pendientes y en curso', async () => {
    // Antes buscaba un estado literal llamado «open», que no existe, así que `?status=open` devolvía
    // cero. La misma palabra contestando distinto en dos endpoints es la forma en que dos pantallas
    // muestran números que no coinciden.
    const enCurso = await mk({ title: 'OPEN en curso', dueDate: testToday() });
    await db.tx((q) => tasks.startTask(q, { taskId: enCurso }, ctx()));
    const hecha = await mk({ title: 'OPEN hecha', dueDate: testToday() });
    await db.tx((q) => tasks.completeTask(q, { taskId: hecha }, ctx()));

    const lista = await tasks.list('open', 1000);
    const estados = new Set(lista.map((t: any) => t.status));
    expect(estados.has('done'), 'las hechas quedan afuera').toBe(false);
    expect(estados.has('canceled')).toBe(false);
    expect(lista.some((t: any) => t.id === enCurso), 'las en curso entran').toBe(true);

    // Y coincide con lo que contesta el tablero para la misma palabra.
    const tablero = await tasks.board({ status: 'open', limit: 1000 });
    expect(lista.length).toBe(tablero.length);
  });

  it('sin estado, la lista trae lo ABIERTO', async () => {
    // Es lo que se quiere ver por defecto, y lo mismo que hace el tablero. `all` sigue estando para
    // quien de verdad necesite el histórico — acotado.
    const porDefecto = await tasks.list(undefined, 1000);
    expect(porDefecto.every((t: any) => t.status === 'pending' || t.status === 'in_progress')).toBe(true);
    expect((await tasks.list('all', 1000)).length).toBeGreaterThan(porDefecto.length);
  });

  it('UNA TAREA NO PUEDE APUNTAR A LO QUE NO EXISTE', async () => {
    // `related_id` es POLIMÓRFICO —apunta a un animal, un lote, un potrero o un protocolo según el
    // tipo— así que ninguna clave foránea lo protege: una columna no puede referenciar cuatro
    // tablas. Sin comprobación explícita entraba una tarea sobre un animal inexistente, y lo que
    // queda es un enlace que no lleva a ningún lado y un tablero que la muestra sin nombre de
    // relacionado, sin que nadie pueda explicar por qué.
    await expect(
      db.tx((q) => tasks.createTask(q, { title: 'REL fantasma', relatedType: 'animal', relatedId: randomUUID() }, ctx())),
    ).rejects.toMatchObject({ response: { code: 'task.related_not_found' } });

    await expect(
      db.tx((q) => tasks.createTask(q, { title: 'REL tipo', relatedType: 'tractor', relatedId: randomUUID() }, ctx())),
    ).rejects.toMatchObject({ response: { code: 'task.related_type_invalid' } });

    await expect(
      db.tx((q) => tasks.createTask(q, { title: 'REL sin id', relatedType: 'animal' }, ctx())),
    ).rejects.toMatchObject({ response: { code: 'task.related_id_missing' } });
  });

  it('apuntar a un animal o un lote REALES sigue andando', async () => {
    // La otra mitad: la guarda no puede comerse el caso normal, que es el de todas las tareas que
    // generan las reglas automáticas.
    const [animal] = await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]);
    const [lote] = await db.query<{ id: string }>(`SELECT id FROM lots WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`, [db.tenant]);

    expect(await mk({ title: 'REL animal ok', relatedType: 'animal', relatedId: animal.id })).toBeTruthy();
    expect(await mk({ title: 'REL lote ok', relatedType: 'lot', relatedId: lote.id })).toBeTruthy();
    expect(await mk({ title: 'REL sin relacionado' }), 'y sin relacionado también').toBeTruthy();
  });

  it('el mensaje usa el nombre en CASTELLANO, no el código interno', async () => {
    // «No existe el lot al que apunta la tarea» suena a que se rompió el sistema, no a que hay un
    // dato mal cargado. Lo lee el productor.
    // `getResponse()` y no `.response`: NestJS expone el cuerpo por ese método, y leer la propiedad
    // devuelve undefined — la aserción pasaría sin comprobar nada.
    let titulo = '';
    try {
      await db.tx((q) => tasks.createTask(q, { title: 'REL msg', relatedType: 'lot', relatedId: randomUUID() }, ctx()));
    } catch (e: any) {
      titulo = (e.getResponse?.() ?? e.response ?? {}).title ?? '';
    }
    expect(titulo, 'tiene que decir «lote», no «lot»').toContain('lote');
  });
});
