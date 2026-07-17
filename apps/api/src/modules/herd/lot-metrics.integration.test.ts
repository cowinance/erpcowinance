import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Etapa 4 — métricas por propósito del lote. Se siembran datos controlados por propósito y se verifica
 * que `lotMetrics` deriva los indicadores correctos reusando la infraestructura existente.
 */
describe('HerdService.lotMetrics — métricas por propósito', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let cat: Record<string, string> = {};

  const mkLot = async (name: string, purpose: string) => {
    const id = (await herd.createLot({ name, purpose }) as any).id;
    return id;
  };
  const mkAnimal = async (lot: string, sex: string, catCode?: string, birthMonthsAgo?: number) =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, current_lot_id, birth_date) VALUES ($1,$2,$3,$4,$5,'active',$6,$7) RETURNING id`,
      [db.tenant, farmId, speciesId, catCode ? cat[catCode] : null, sex, lot, birthMonthsAgo != null ? new Date(Date.now() - birthMonthsAgo * 30.44 * 86400000).toISOString().slice(0, 10) : null],
    ))[0].id;
  const weigh = (animal: string, at: string, kg: number) => db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,$3,$4)`, [db.tenant, animal, at, kg]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lot-metrics-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    for (const code of ['vaca', 'toro', 'vaquillona', 'ternero']) {
      cat[code] = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code=$1 LIMIT 1`, [code]))[0].id;
    }
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cría: vientres, toros, preñadas, vacías, crías al pie', async () => {
    const lot = await mkLot('Cría M', 'breeding');
    const v1 = await mkAnimal(lot, 'F', 'vaca');
    await mkAnimal(lot, 'F', 'vaca'); // vacía
    await mkAnimal(lot, 'M', 'toro');
    await mkAnimal(lot, 'M', 'ternero');
    await db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status) VALUES ($1,$2,CURRENT_DATE,'open')`, [db.tenant, v1]);
    const res: any = await herd.lotMetrics(lot);
    expect(res.purpose).toBe('breeding');
    expect(res.metrics).toMatchObject({ vientres: 2, toros: 1, prenadas: 1, vacias: 1, crias_al_pie: 1 });
  });

  it('recría: peso inicial/actual, GDP y edad promedio', async () => {
    const lot = await mkLot('Recría M', 'weaning');
    const a1 = await mkAnimal(lot, 'M', undefined, 8);
    const a2 = await mkAnimal(lot, 'F', undefined, 10);
    await weigh(a1, '2030-01-01', 200); await weigh(a1, '2030-03-02', 260); // +60 en 60 días
    await weigh(a2, '2030-01-01', 220); await weigh(a2, '2030-03-02', 280);
    const res: any = await herd.lotMetrics(lot);
    expect(res.purpose).toBe('weaning');
    expect(res.metrics.head).toBe(2);
    expect(res.metrics.peso_inicial).toBe(210); // (200+220)/2
    expect(res.metrics.peso_actual).toBe(270); // (260+280)/2
    expect(res.metrics.gdp).toBeCloseTo(1, 1);
    expect(res.metrics.edad_prom_meses).toBeGreaterThan(0);
  });

  it('engorde: conversión y costo por kg reusando computeFeedlotMetrics', async () => {
    const lot = await mkLot('Engorde M', 'fattening');
    const a1 = await mkAnimal(lot, 'M');
    const a2 = await mkAnimal(lot, 'M');
    await weigh(a1, '2030-01-01', 300); await weigh(a1, '2030-02-20', 360); // +60
    await weigh(a2, '2030-01-01', 320); await weigh(a2, '2030-02-20', 370); // +50 → total 110
    await db.query(`INSERT INTO feed_deliveries (tenant_id, lot_id, delivered_at, quantity_kg, total_cost) VALUES ($1,$2,'2030-02-01',$3,$4)`, [db.tenant, lot, 880, 440]);
    const res: any = await herd.lotMetrics(lot);
    expect(res.purpose).toBe('fattening');
    expect(res.metrics.kg_gained).toBe(110);
    expect(res.metrics.conversion).toBe(8); // 880/110
    expect(res.metrics.cost_per_kg_gained).toBe(4); // 440/110
  });

  it('devuelve la forma correcta para hospital y cuarentena sin error', async () => {
    const h = await mkLot('Hosp M', 'hospital');
    await mkAnimal(h, 'M');
    const rh: any = await herd.lotMetrics(h);
    expect(rh.purpose).toBe('hospital');
    expect(rh.metrics).toHaveProperty('tratamientos_vigentes');
    const q = await mkLot('Cuar M', 'quarantine');
    const rq: any = await herd.lotMetrics(q);
    expect(rq.purpose).toBe('quarantine');
    expect(rq.metrics).toHaveProperty('fecha_liberacion');
  });
});
