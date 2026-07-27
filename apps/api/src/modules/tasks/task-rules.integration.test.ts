import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { TaskService } from './task.service';
import { TaskRulesService } from './task-rules.service';
import { addFarmDays } from '@cowinance/domain';
import { testToday, testDay } from '../../db/test-today';

/**
 * Tareas E4 — reglas ganaderas automáticas. Dedup por rule_key (una tarea viva por regla+entidad),
 * materialización idempotente (re-correr no duplica), y creación por condición (sin pesaje reciente).
 */
describe('TaskRulesService · reglas automáticas (E4)', () => {
  let db: DbService;
  let tasks: TaskService;
  let rules: TaskRulesService;
  let userId: string;
  let farmId: string;
  let speciesId: string;
  let catVaca: string;
  let originalCwd: string;
  let tmp: string;
  const ctx = () => ({ origin: 'rest' as const, emitServerOrigin: true, actorUserId: userId });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'taskrules-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    tasks = new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    rules = new TaskRulesService(db, tasks);
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    catVaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('createTask deduplica por rule_key: una viva por (tenant, rule_key)', async () => {
    const r1 = await db.tx((q) => tasks.createTask(q, { title: 'Pesar X', ruleKey: 'weigh_due:test-1' }, ctx()));
    expect(r1.already).toBeFalsy();
    const r2 = await db.tx((q) => tasks.createTask(q, { title: 'Pesar X (otra vez)', ruleKey: 'weigh_due:test-1' }, ctx()));
    expect(r2.already).toBe(true);
    expect(r2.taskId).toBe(r1.taskId);
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE rule_key='weigh_due:test-1' AND deleted_at IS NULL`, []))[0].n;
    expect(n).toBe(1);
    // Al completarla, la clave queda libre y se puede volver a generar (nueva vuelta).
    await db.tx((q) => tasks.completeTask(q, { taskId: r1.taskId }, ctx()));
    const r3 = await db.tx((q) => tasks.createTask(q, { title: 'Pesar X (nueva vuelta)', ruleKey: 'weigh_due:test-1' }, ctx()));
    expect(r3.already).toBeFalsy();
    expect(r3.taskId).not.toBe(r1.taskId);
  });

  it('materialize crea tareas por condición (sin pesaje) y es idempotente al re-correr', async () => {
    // Animal activo SIN pesaje → debe generar weigh_due.
    const a = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id) VALUES ($1,$2,$3,'F','active',$4) RETURNING id`,
        [db.tenant, farmId, speciesId, catVaca],
      )
    )[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','RULE-1')`, [db.tenant, a]);

    const first = await rules.materialize({ weighDays: 60, lotReviewDays: 30 });
    expect(first.created.weigh_due).toBeGreaterThanOrEqual(1);
    // La tarea del animal quedó con su rule_key.
    const hasTask = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE rule_key=$1 AND deleted_at IS NULL`, [`weigh_due:${a}`]))[0].n;
    expect(hasTask).toBe(1);

    // Re-correr NO duplica (dedup).
    const second = await rules.materialize({ weighDays: 60, lotReviewDays: 30 });
    expect(second.created.weigh_due).toBe(0);
    const still = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE rule_key=$1 AND deleted_at IS NULL`, [`weigh_due:${a}`]))[0].n;
    expect(still).toBe(1);
  });

  it('materialize devuelve conteos por regla', async () => {
    const res = await rules.materialize();
    expect(res.created).toHaveProperty('weigh_due');
    expect(res.created).toHaveProperty('vaccine_due');
    expect(res.created).toHaveProperty('withdrawal_end');
    expect(res.created).toHaveProperty('lot_review');
    expect(res.created).toHaveProperty('recurring');
    expect(typeof res.total).toBe('number');
  });

  it('recurrencia: genera 1 instancia al crear; completar avanza next_due; una viva a la vez', async () => {
    const today = testToday();
    const { id, generated } = await rules.createRecurrence({ title: 'Revisar bebederos', interval_days: 7, anchor: 'due_date', next_due: today, type: 'maintenance' });
    expect(generated).toBe(1); // primera instancia creada de una
    const inst1 = (await db.query<any>(`SELECT id, status, due_date::text AS due FROM tasks WHERE recurrence_id=$1 AND deleted_at IS NULL`, [id]));
    expect(inst1).toHaveLength(1);
    expect(inst1[0].due).toContain(today);

    // Re-materializar NO crea otra (ya hay una viva).
    const again = await rules.materialize();
    expect(again.created.recurring).toBe(0);
    expect((await db.query<any>(`SELECT count(*)::int AS n FROM tasks WHERE recurrence_id=$1 AND deleted_at IS NULL`, [id]))[0].n).toBe(1);

    // Completar la instancia → next_due avanza +7 días (anchor due_date).
    await db.tx((q) => tasks.completeTask(q, { taskId: inst1[0].id }, ctx()));
    const nd = (await db.query<any>(`SELECT next_due::text AS next_due FROM task_recurrences WHERE id=$1`, [id]))[0].next_due;
    const expected = addFarmDays(today, 7);
    expect(nd).toContain(expected);

    // Como next_due es futuro, materializar NO genera todavía (evita duplicar).
    const noGen = await rules.materialize();
    expect(noGen.created.recurring).toBe(0);
    // Forzamos next_due a hoy → materializa la SIGUIENTE instancia.
    await db.query(`UPDATE task_recurrences SET next_due=CURRENT_DATE WHERE id=$1`, [id]);
    const gen2 = await rules.materialize();
    expect(gen2.created.recurring).toBe(1);
    const live = (await db.query<any>(`SELECT count(*)::int AS n FROM tasks WHERE recurrence_id=$1 AND deleted_at IS NULL AND status IN ('pending','in_progress')`, [id]))[0].n;
    expect(live).toBe(1); // solo la nueva viva (la anterior quedó done)
  });

  it('desactivar recurrencia detiene la generación', async () => {
    const today = testToday();
    const { id } = await rules.createRecurrence({ title: 'Limpieza de corral', interval_days: 30, next_due: today });
    // completar la instancia para que la clave quede libre
    const inst = (await db.query<any>(`SELECT id FROM tasks WHERE recurrence_id=$1 AND status='pending'`, [id]))[0];
    await db.tx((q) => tasks.completeTask(q, { taskId: inst.id }, ctx()));
    await db.query(`UPDATE task_recurrences SET next_due=CURRENT_DATE WHERE id=$1`, [id]);
    await rules.deactivateRecurrence(id);
    const res = await rules.materialize();
    // No genera para la desactivada.
    const live = (await db.query<any>(`SELECT count(*)::int AS n FROM tasks WHERE recurrence_id=$1 AND status IN ('pending','in_progress')`, [id]))[0].n;
    expect(live).toBe(0);
  });
});
