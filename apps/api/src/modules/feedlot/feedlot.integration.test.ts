import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { FeedlotService } from './feedlot.service';

/**
 * Integración de engorde (C2 · feedlot): compone lote de engorde (purpose='fattening') + animales
 * (current_lot_id) + pesajes (v_weighings, GDP) + entregas de alimento, y deriva los KPIs con la regla
 * de dominio. Se siembran datos controlados para números exactos. `db.tenant` cae al demo.
 */
describe('feedlot — engorde a corral', () => {
  let db: DbService;
  let svc: FeedlotService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let lotId: string;

  const mkAnimal = async (sex: string) =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, current_lot_id, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
      [tenantId, farmId, speciesId, sex, lotId],
    ))[0].id;
  const weigh = async (animalId: string, at: string, kg: number) =>
    db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,$3,$4)`, [tenantId, animalId, at, kg]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'feedlot-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new FeedlotService(db);
    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    lotId = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Corral 1','fattening') RETURNING id`, [tenantId, farmId]))[0].id;

    // Animal 1: 400→460 en 50 días (gana 60, GDP 1.2). Animal 2: 380→430 (gana 50, GDP 1.0).
    const a1 = await mkAnimal('M');
    const a2 = await mkAnimal('M');
    await weigh(a1, '2030-01-01', 400);
    await weigh(a1, '2030-02-20', 460);
    await weigh(a2, '2030-01-01', 380);
    await weigh(a2, '2030-02-20', 430);
    // Alimento: 880 kg, $440.
    await db.query(`INSERT INTO feed_deliveries (tenant_id, lot_id, delivered_at, quantity_kg, total_cost) VALUES ($1,$2,'2030-02-01',$3,$4)`, [tenantId, lotId, 880, 440]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lista los corrales de engorde con KPIs derivados', async () => {
    const rows: any[] = await svc.lots();
    const corral = rows.find((r) => r.id === lotId);
    expect(corral).toBeDefined();
    expect(corral.head).toBe(2);
    expect(corral.feed_kg).toBe(880);
    expect(corral.feed_cost).toBe(440);
    expect(corral.kg_gained).toBe(110); // 60 + 50
    expect(corral.avg_weight_kg).toBe(445); // (460 + 430) / 2
    expect(corral.avg_adg).toBeCloseTo(1.1, 3); // (1.2 + 1.0) / 2
    expect(corral.conversion).toBe(8); // 880 / 110
    expect(corral.cost_per_kg_gained).toBe(4); // 440 / 110
    expect(corral.days_to_finish).toBeNull(); // sin objetivo
  });

  it('con peso objetivo, deriva días a terminación', async () => {
    const rows: any[] = await svc.lots(500);
    const corral = rows.find((r) => r.id === lotId);
    expect(corral.days_to_finish).toBe(50); // (500 − 445) / 1.1 = 50
  });

  it('detalle del corral incluye el desglose por animal', async () => {
    const detail: any = await svc.get(lotId, 500);
    expect(detail.head).toBe(2);
    expect(detail.animals).toHaveLength(2);
    expect(detail.animals[0].weight_kg).toBeGreaterThan(0);
    await expect(svc.get('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  it('solo considera lotes con purpose=fattening', async () => {
    const otherLot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name, purpose) VALUES ($1,$2,'Cría 1','breeding') RETURNING id`, [tenantId, farmId]))[0].id;
    const rows: any[] = await svc.lots();
    expect(rows.some((r) => r.id === otherLot)).toBe(false);
  });
});
