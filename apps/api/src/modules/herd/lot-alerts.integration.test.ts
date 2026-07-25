import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { LotsService } from './lots.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Etapa 5 — alertas operativas + estado del lote. Datos controlados: un lote sin potrero con animales
 * sin identificación ni pesaje reciente y mezcla de categorías → varias alertas; un lote vacío → estado
 * 'empty'; un lote sano → 'active' sin alertas.
 */
describe('HerdService — alertas operativas y estado del lote', () => {
  let db: DbService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let paddockId: string;
  let cat: Record<string, string> = {};

  const mkLot = async (name: string) => (await lotsSvc.createLot({ name }) as any).id;
  const mkAnimal = async (lot: string, catCode: string, tag?: string, weighDaysAgo?: number) => {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, current_lot_id) VALUES ($1,$2,$3,$4,'F','active',$5) RETURNING id`,
      [db.tenant, farmId, speciesId, cat[catCode], lot],
    ))[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [db.tenant, id, tag]);
    if (weighDaysAgo != null) {
      const at = new Date(Date.now() - weighDaysAgo * 86400000).toISOString().slice(0, 10);
      await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,$3,400)`, [db.tenant, id, at]);
    }
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lot-alerts-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    paddockId = (await db.query<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    for (const c of ['vaca', 'toro', 'ternero', 'vaquillona']) cat[c] = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code=$1 LIMIT 1`, [c]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lote sin potrero, sin id, sin pesaje reciente y con mezcla → varias alertas y estado alert', async () => {
    const lot = await mkLot('Problemático'); // sin potrero
    await mkAnimal(lot, 'vaca'); // sin tag, sin pesaje
    await mkAnimal(lot, 'toro', 'T-1', 200); // pesaje viejo (>90d)
    await mkAnimal(lot, 'ternero', 'C-1', 5); // ok
    const d: any = await lotsSvc.getLot(lot);
    expect(d.status).toBe('alert');
    const codes = d.alerts.map((a: any) => a.code);
    expect(codes).toContain('no_paddock');
    expect(codes).toContain('no_id'); // 1 sin identificación
    expect(codes).toContain('no_weight'); // 2 sin pesaje reciente (uno sin pesaje, otro viejo)
    expect(codes).toContain('mixed'); // 3 categorías distintas
  });

  it('lote vacío → estado empty y alerta de vacío', async () => {
    const lot = await mkLot('Vacío L');
    const d: any = await lotsSvc.getLot(lot);
    expect(d.status).toBe('empty');
    expect(d.alerts.map((a: any) => a.code)).toContain('empty');
  });

  it('lote sano (potrero + id + pesaje reciente, categoría única) → active sin alertas', async () => {
    const lot = await mkLot('Sano L');
    await lotsSvc.updateLot(lot, { is_active: true }); // asegura activo
    await db.query(`UPDATE lots SET current_paddock_id=$2 WHERE id=$1`, [lot, paddockId]);
    await mkAnimal(lot, 'vaca', 'S-1', 3);
    await mkAnimal(lot, 'vaca', 'S-2', 4);
    const d: any = await lotsSvc.getLot(lot);
    expect(d.status).toBe('active');
    expect(d.alerts).toHaveLength(0);
  });

  it('la lista expone status y alert_count por lote', async () => {
    const list: any[] = await lotsSvc.lots();
    expect(list.every((l) => 'status' in l && 'alert_count' in l)).toBe(true);
    expect(list.some((l) => l.status === 'alert' && l.alert_count > 0)).toBe(true);
  });
});
