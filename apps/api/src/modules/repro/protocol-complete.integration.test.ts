import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import type { WeaningService } from './weaning.service';

/**
 * Reproducción E4 — protocolos completos: aplicar a lote/categoría/selección, snapshot de vientres,
 * dedup (no reasignar a animales ya en el protocolo activo), completar pasos que registran EVENTOS
 * REALES (hormonal → sincronización; inseminación → servicio IATF) idempotentes, y progreso.
 */
describe('repro — protocolos completos (E4)', () => {
  let db: DbService;
  let repro: ReproService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let lot: string;
  let protoId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

  const mkVaca = async (l: string): Promise<string> =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin) VALUES ($1,$2,$3,$4,$5,'F','active','born') RETURNING id`,
      [t, farmId, speciesId, vaca, l],
    ))[0].id;
  const bevents = async (animal: string, type: string) => (await db.query<any>(`SELECT count(*)::int AS n FROM breeding_events WHERE animal_id=$1 AND type=$2`, [animal, type]))[0].n;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-e4-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), new SemenService(db), new EmbryosService(db));
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('LOT')]))[0].id;
    const proto: any = await repro.createProtocol({
      name: 'IATF ' + Date.now(),
      steps: [
        { day: 0, action: 'Implante + GnRH', kind: 'hormonal' },
        { day: 8, action: 'Retiro + PGF', kind: 'device_removal' },
        { day: 10, action: 'IATF', kind: 'insemination' },
        { day: 40, action: 'Diagnóstico', kind: 'diagnosis' },
      ],
    });
    protoId = proto.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('asigna a un lote, snapshotea vientres y genera una tarea por paso', async () => {
    const a1 = await mkVaca(lot);
    const a2 = await mkVaca(lot);
    const res: any = await repro.assignProtocol({ protocol_id: protoId, lot_id: lot, start_date: '2027-05-01' });
    expect(res.target_type).toBe('lot');
    expect(res.animals).toBe(2);
    expect(res.tasks_created).toBe(4);
    const snap = await db.query(`SELECT animal_id FROM repro_protocol_assignment_animals WHERE assignment_id=$1`, [res.assignment.id]);
    expect(snap.map((x: any) => x.animal_id).sort()).toEqual([a1, a2].sort());
  });

  it('dedup: reasignar el mismo protocolo al lote excluye los ya asignados → 409 si todos están', async () => {
    await expect(repro.assignProtocol({ protocol_id: protoId, lot_id: lot, start_date: '2027-05-15' }))
      .rejects.toMatchObject({ response: { code: 'assignment.all_in_protocol' } });
  });

  it('completar paso hormonal registra sincronización por animal (idempotente)', async () => {
    const l2 = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('L2')]))[0].id;
    const a = await mkVaca(l2);
    const asg: any = await repro.assignProtocol({ protocol_id: protoId, lot_id: l2, start_date: '2027-05-01' });
    const r1: any = await repro.completeStep(asg.assignment.id, 0, {}); // hormonal
    expect(r1.kind).toBe('hormonal');
    expect(r1.events_created).toBe(1);
    expect(await bevents(a, 'synchronization')).toBe(1);
    // reproceso del mismo paso → no duplica el evento
    await repro.completeStep(asg.assignment.id, 0, {});
    expect(await bevents(a, 'synchronization')).toBe(1);
  });

  it('completar paso de inseminación registra un servicio IATF por animal', async () => {
    const l3 = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('L3')]))[0].id;
    const a = await mkVaca(l3);
    const asg: any = await repro.assignProtocol({ protocol_id: protoId, lot_id: l3, start_date: '2027-05-01' });
    const r: any = await repro.completeStep(asg.assignment.id, 2, { occurred_at: '2027-05-11' }); // insemination
    expect(r.kind).toBe('insemination');
    expect(await bevents(a, 'service_ai')).toBe(1);
    // progreso refleja los pasos completados
    const prog: any = await repro.assignmentProgress(asg.assignment.id);
    expect(prog.steps_total).toBe(4);
    expect(prog.steps.find((s: any) => s.index === 2).completed).toBe(true);
  });

  it('asigna por selección explícita de animales', async () => {
    const l4 = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('L4')]))[0].id;
    const a1 = await mkVaca(l4);
    await mkVaca(l4); // no seleccionada
    const res: any = await repro.assignProtocol({ protocol_id: protoId, animal_ids: [a1], start_date: '2027-05-01' });
    expect(res.target_type).toBe('selection');
    expect(res.animals).toBe(1);
  });
});
