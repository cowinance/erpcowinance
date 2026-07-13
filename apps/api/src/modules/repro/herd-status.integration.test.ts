import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import type { WeaningService } from './weaning.service';

/**
 * Integración del estado reproductivo del rodeo (R-1). Aísla con un lote propio (filtro lot_id) y
 * vientres con historias controladas. Fija la taxonomía: preñada > (último servicio vs último
 * diagnóstico negativo) > sin actividad; y la exclusión de no-vientres.
 */
describe('repro.herdStatus — estado del rodeo', () => {
  let db: DbService;
  let repro: ReproService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let novillo: string;
  let lot: string;
  let originalCwd: string;
  let tmp: string;

  const mkAnimal = async (catId: string, sex = 'F'): Promise<string> =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin)
         VALUES ($1,$2,$3,$4,$5,$6,'active','born') RETURNING id`,
        [t, farmId, speciesId, catId, lot, sex],
      )
    )[0].id;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const preg = (animal: string) =>
    db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, expected_due_date) VALUES ($1,$2,CURRENT_DATE - 60,'open',CURRENT_DATE + 220)`, [t, animal]);
  const pregLost = (animal: string) =>
    db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, closed_at) VALUES ($1,$2,CURRENT_DATE - 90,'lost',CURRENT_DATE - 5)`, [t, animal]);
  const service = (animal: string, at: string) =>
    db.query(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at) VALUES ($1,$2,'service_ai',$3)`, [t, animal, at]);
  const negative = (animal: string, at: string) =>
    db.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at) VALUES ($1,$2,'pregnancy_negative','{}'::jsonb,$3,$3)`, [t, animal, at]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'herd-status-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    novillo = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'novillo'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, `Rodeo R1-${Date.now()}`]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resuelve los 4 estados, excluye no-vientres y cuenta bien; filtro por lote aísla', async () => {
    const vPreg = await mkAnimal(vaca);
    await preg(vPreg);
    const vServed = await mkAnimal(vaca);
    await service(vServed, daysAgo(5));
    const vServedAfterNeg = await mkAnimal(vaca);
    await negative(vServedAfterNeg, daysAgo(20));
    await service(vServedAfterNeg, daysAgo(5)); // servicio posterior al negativo → servida
    const vEmpty = await mkAnimal(vaca);
    await service(vEmpty, daysAgo(20));
    await negative(vEmpty, daysAgo(5)); // negativo posterior al servicio → vacía
    const vEmptyNoSvc = await mkAnimal(vaca);
    await negative(vEmptyNoSvc, daysAgo(5)); // solo negativo → vacía
    const vLost = await mkAnimal(vaca);
    await pregLost(vLost);
    await negative(vLost, daysAgo(5)); // preñez perdida + negativo, sin re-servicio → vacía
    const vIdle = await mkAnimal(vaca);
    await mkAnimal(novillo, 'M'); // no-vientre en el mismo lote → excluido

    const res = await repro.herdStatus(lot);
    const by = new Map(res.rows.map((r: any) => [r.animal_id, r.status]));

    expect(by.get(vPreg)).toBe('pregnant');
    expect(by.get(vServed)).toBe('served');
    expect(by.get(vServedAfterNeg)).toBe('served');
    expect(by.get(vEmpty)).toBe('empty');
    expect(by.get(vEmptyNoSvc)).toBe('empty');
    expect(by.get(vLost)).toBe('empty');
    expect(by.get(vIdle)).toBe('idle');

    expect(res.counts).toEqual({ pregnant: 1, served: 2, empty: 3, idle: 1, total: 7 }); // novillo excluido
    const pregRow = res.rows.find((r: any) => r.animal_id === vPreg)!;
    expect(pregRow.expected_due_date).toBeTruthy();
    expect(pregRow.days_until).toBeGreaterThan(0);
  });
});
