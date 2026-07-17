import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { TaskService } from '../tasks/task.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import type { WeaningService } from './weaning.service';

/**
 * Integración de la asignación de protocolos (R-2.b.1): asignar a un lote genera UNA tarea por
 * paso (nivel grupo) con due_date correcto y animal_count snapshot; cancelar cancela la asignación
 * y sus tareas pendientes. TaskService real (genera tareas vía la regla única de P6).
 */
describe('repro asignaciones de protocolo', () => {
  let db: DbService;
  let repro: ReproService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let novillo: string;
  let originalCwd: string;
  let tmp: string;

  const mkLot = async (name: string) => (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, name]))[0].id;
  const mkAnimal = async (catId: string, lotId: string) =>
    (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin) VALUES ($1,$2,$3,$4,$5,'F','active','born') RETURNING id`, [t, farmId, speciesId, catId, lotId]))[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'proto-assign-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), new SemenService(db), new EmbryosService(db));
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    novillo = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'novillo'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('asigna → 1 tarea por paso con due_date correcto y animal_count; cancelar cancela todo', async () => {
    const proto = await repro.createProtocol({ name: 'IATF asign', steps: [{ day: 0, action: 'Implante' }, { day: 8, action: 'Retiro' }, { day: 10, action: 'IATF' }] });
    const lot = await mkLot(`Lote asign ${Date.now()}`);
    await mkAnimal(vaca, lot);
    await mkAnimal(vaca, lot);
    await mkAnimal(novillo, lot); // no-vientre → no cuenta

    const res = await repro.assignProtocol({ protocol_id: proto.id, lot_id: lot, start_date: '2027-05-01' });
    expect(res.assignment.animal_count).toBe(2);
    expect(res.tasks_created).toBe(3);

    const tasks = await db.query<any>(
      `SELECT title, type, related_type, related_id, due_date::date::text AS due, status
       FROM tasks WHERE tenant_id=$1 AND related_type='protocol_assignment' AND related_id=$2 ORDER BY due_date`,
      [t, res.assignment.id],
    );
    expect(tasks.map((x: any) => x.due)).toEqual(['2027-05-01', '2027-05-09', '2027-05-11']);
    expect(tasks.every((x: any) => x.type === 'breeding' && x.status === 'pending')).toBe(true);
    expect(tasks[0].title).toContain('2 vientres');

    // Cancelar → asignación canceled + tareas pendientes canceladas.
    const cancel = await repro.cancelAssignment(res.assignment.id);
    expect(cancel.canceled_tasks).toBe(3);
    const after = await db.query<any>(`SELECT status FROM tasks WHERE tenant_id=$1 AND related_id=$2`, [t, res.assignment.id]);
    expect(after.every((x: any) => x.status === 'canceled')).toBe(true);
    const list = await repro.listAssignments();
    expect(list.find((a: any) => a.id === res.assignment.id)?.status).toBe('canceled');
  });

  it('objetivo vacío → 400; errores de validación', async () => {
    const empty = await repro.createProtocol({ name: 'Sin pasos', steps: [] });
    const lot = await mkLot(`Lote vacío ${Date.now()}`);
    // Lote sin vientres → no hay objetivo → 400 (antes creaba una asignación vacía).
    await expect(repro.assignProtocol({ protocol_id: empty.id, lot_id: lot, start_date: '2027-06-01' })).rejects.toMatchObject({ status: 400 });

    await expect(repro.assignProtocol({ protocol_id: empty.id, lot_id: lot })).rejects.toMatchObject({ status: 400 });
    await expect(repro.assignProtocol({ protocol_id: '00000000-0000-0000-0000-000000000000', lot_id: lot, start_date: '2027-06-01' })).rejects.toMatchObject({ status: 404 });
    await expect(repro.cancelAssignment('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});
