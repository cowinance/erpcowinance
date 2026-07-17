import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';
import { HospitalizationService } from './hospitalization.service';

/**
 * Sanidad E6 — internaciones hospital/cuarentena. El ingreso mueve el animal al lote hospital/cuarentena
 * REUSANDO la regla única de movimientos (crea fila en animal_movements, no update directo), guarda el
 * lote de origen, y el alta lo devuelve a ese lote (o a uno destino). Validaciones: lote no admisible,
 * tipo que no coincide, una sola internación abierta por animal; idempotencia por Idempotency-Key.
 */
describe('HospitalizationService · integración', () => {
  let db: DbService;
  let svc: HospitalizationService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let baseLot: string;
  let hospitalLot: string;
  let quarantineLot: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `HA-${p}-${Date.now()}-${seq++}`;

  const mkLot = async (name: string, purpose: string | null) =>
    (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, purpose, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenantId, farmId, name, purpose, userId]))[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'hospitalization-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new HospitalizationService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    baseLot = await mkLot(uniq('BASE'), 'breeding');
    hospitalLot = await mkLot(uniq('HOSP'), 'hospital');
    quarantineLot = await mkLot(uniq('CUAR'), 'quarantine');
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(lot: string | null, tag: string): Promise<string> {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, current_lot_id) VALUES ($1,$2,$3,'F','active','born',$4) RETURNING id`,
      [tenantId, farmId, speciesId, lot],
    ))[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  }
  const lotOf = async (id: string) => (await db.query<any>(`SELECT current_lot_id FROM animals WHERE id=$1`, [id]))[0].current_lot_id;
  const movements = async (id: string) => (await db.query<any>(`SELECT count(*)::int AS n FROM animal_movements WHERE animal_id=$1`, [id]))[0].n;

  it('ingreso mueve el animal al hospital (regla única) y guarda el lote de origen', async () => {
    const a = await animal(baseLot, uniq('T'));
    const adm: any = await svc.admit({ animal_id: a, lot_id: hospitalLot, reason: 'neumonía' });
    expect(adm.kind).toBe('hospital');
    expect(adm.status).toBe('admitted');
    expect(adm.from_lot_id).toBe(baseLot);
    expect(await lotOf(a)).toBe(hospitalLot); // el animal SE MOVIÓ
    expect(await movements(a)).toBeGreaterThanOrEqual(1); // fila en animal_movements (no update directo)
    const ev = await db.query(`SELECT id FROM animal_events WHERE animal_id=$1 AND event_type='admission'`, [a]);
    expect(ev).toHaveLength(1);
  });

  it('un animal no puede tener dos internaciones abiertas', async () => {
    const a = await animal(baseLot, uniq('D'));
    await svc.admit({ animal_id: a, lot_id: hospitalLot });
    await expect(svc.admit({ animal_id: a, lot_id: quarantineLot })).rejects.toMatchObject({ response: { code: 'admission.already_open' } });
  });

  it('lote no admisible (no hospital/cuarentena) → 409', async () => {
    const a = await animal(baseLot, uniq('X'));
    await expect(svc.admit({ animal_id: a, lot_id: baseLot })).rejects.toMatchObject({ response: { code: 'admission.lot_not_admissible' } });
  });

  it('tipo explícito que no coincide con el propósito del lote → 409', async () => {
    const a = await animal(baseLot, uniq('K'));
    await expect(svc.admit({ animal_id: a, lot_id: hospitalLot, kind: 'quarantine' })).rejects.toMatchObject({ response: { code: 'admission.kind_mismatch' } });
  });

  it('alta sanitaria devuelve el animal a su lote anterior', async () => {
    const a = await animal(baseLot, uniq('R'));
    const adm: any = await svc.admit({ animal_id: a, lot_id: hospitalLot });
    expect(await lotOf(a)).toBe(hospitalLot);
    const out: any = await svc.discharge(adm.id, {});
    expect(out.status).toBe('discharged');
    expect(await lotOf(a)).toBe(baseLot); // volvió a su lote
  });

  it('alta a un lote destino específico', async () => {
    const a = await animal(baseLot, uniq('Q'));
    const dest = await mkLot(uniq('DEST'), 'fattening');
    const adm: any = await svc.admit({ animal_id: a, lot_id: quarantineLot });
    const out: any = await svc.discharge(adm.id, { discharge_lot_id: dest });
    expect(out.status).toBe('discharged');
    expect(await lotOf(a)).toBe(dest);
  });

  it('ingreso idempotente por Idempotency-Key', async () => {
    const a = await animal(baseLot, uniq('I'));
    const key = randomUUID();
    const first: any = await svc.admit({ animal_id: a, lot_id: hospitalLot }, key);
    const again: any = await svc.admit({ animal_id: a, lot_id: hospitalLot }, key);
    expect(again.id).toBe(first.id);
    expect(again.already_admitted).toBe(true);
    const rows = await db.query(`SELECT id FROM health_admissions WHERE animal_id=$1`, [a]);
    expect(rows).toHaveLength(1);
  });

  it('ingreso desde un caso clínico agrega un evento al caso', async () => {
    const a = await animal(baseLot, uniq('C'));
    const caseId = (await db.query<{ id: string }>(`INSERT INTO clinical_cases (tenant_id, animal_id, status, started_at, created_by) VALUES ($1,$2,'open',now(),$3) RETURNING id`, [tenantId, a, userId]))[0].id;
    await svc.admit({ animal_id: a, lot_id: hospitalLot, case_id: caseId, reason: 'observación' });
    const ev = await db.query<any>(`SELECT note FROM clinical_case_events WHERE case_id=$1 AND kind='note'`, [caseId]);
    expect(ev.some((e: any) => /hospital/i.test(e.note))).toBe(true);
  });
});
