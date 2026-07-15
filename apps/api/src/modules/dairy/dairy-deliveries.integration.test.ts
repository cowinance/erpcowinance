import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CommerceService } from '../commerce/commerce.service';
import { DairyService } from './dairy.service';

/**
 * Integración de entregas + calidad del tambo (TB-2): comprador = cliente, `amount` derivado, y test de
 * calidad con exactamente una referencia (animal o tanque). `db.tenant` cae al demo.
 */
describe('dairy — entregas y calidad', () => {
  let db: DbService;
  let commerce: CommerceService;
  let svc: DairyService;
  let originalCwd: string;
  let tmp: string;
  let buyerId: string;
  let tankId: string;
  let cow: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'dairy2-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    commerce = new CommerceService(db);
    svc = new DairyService(db);
    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Usina Láctea', customer_segment: 'dairy' });
    // buyer_id es un customers.id (satélite), no el business_partners.id.
    buyerId = (await db.query<{ id: string }>(`SELECT id FROM customers WHERE partner_id=$1`, [cust.id]))[0].id;
    tankId = ((await svc.createTank({ name: 'Tanque 1', capacity_liters: 3000 })) as any).id;
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code='bovine'`))[0].id;
    cow = (await db.query<{ id: string }>(`INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F','active','born') RETURNING id`, [db.tenant, farmId, speciesId]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('entrega: comprador = cliente, `amount` derivado (litros × precio)', async () => {
    await svc.recordDelivery({ delivered_at: '2030-05-01T08:00:00Z', liters: 1500, tank_id: tankId, buyer_id: buyerId, price_per_liter: 0.45 });
    const rows: any[] = await svc.listDeliveries();
    const d = rows[0];
    expect(d.liters).toBe(1500);
    expect(d.buyer_name).toBe('Usina Láctea');
    expect(d.amount).toBe(675); // 1500 × 0.45
  });

  it('entrega: comprador no-cliente → 404; litros ≤ 0 → 400', async () => {
    await expect(svc.recordDelivery({ delivered_at: '2030-05-01T08:00:00Z', liters: 100, buyer_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.recordDelivery({ delivered_at: '2030-05-01T08:00:00Z', liters: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('calidad: test de un animal y de un tanque', async () => {
    const qa: any = await svc.recordQualityTest({ sample_date: '2030-05-02', animal_id: cow, fat_pct: 3.7, protein_pct: 3.2, scc: 180000 });
    expect(qa.animal_id).toBe(cow);
    expect(qa.fat_pct).toBe(3.7);
    const qt: any = await svc.recordQualityTest({ sample_date: '2030-05-02', tank_id: tankId, fat_pct: 3.6 });
    expect(qt.tank_id).toBe(tankId);
  });

  it('calidad: exige EXACTAMENTE una referencia (ninguna o ambas → 400); ajena → 404', async () => {
    await expect(svc.recordQualityTest({ sample_date: '2030-05-02', fat_pct: 3.5 })).rejects.toMatchObject({ status: 400 }); // ninguna
    await expect(svc.recordQualityTest({ sample_date: '2030-05-02', animal_id: cow, tank_id: tankId })).rejects.toMatchObject({ status: 400 }); // ambas
    await expect(svc.recordQualityTest({ sample_date: '2030-05-02', tank_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });
});
