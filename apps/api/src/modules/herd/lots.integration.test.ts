import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Mejora completa de Lotes (B1): detalle con composición (categoría/sexo) + agregados (peso, GDP),
 * edición (nombre/propósito/potrero/estado) y archivado (bloqueado si tiene animales). Animales y
 * pesajes controlados para números exactos.
 */
describe('HerdService — lotes (CRUD + composición)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let vacaCat: string;
  let toroCat: string;
  let paddockId: string;

  const mkAnimal = async (sex: string, cat: string, lot: string, kg: number) => {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, status, current_lot_id) VALUES ($1,$2,$3,$4,$5,'active',$6) RETURNING id`,
      [db.tenant, farmId, speciesId, cat, sex, lot],
    ))[0].id;
    await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,'2030-06-01',$3)`, [db.tenant, id, kg]);
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lots-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    vacaCat = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
    toroCat = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='toro' LIMIT 1`))[0].id;
    paddockId = (await db.query<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea con validación de dominio; rechaza nombre vacío / propósito inválido', async () => {
    const lot: any = await herd.createLot({ name: 'Rodeo Test', purpose: 'breeding' });
    expect(lot.name).toBe('Rodeo Test');
    expect(lot.purpose).toBe('breeding');
    await expect(herd.createLot({ name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(herd.createLot({ name: 'X', purpose: 'cria' })).rejects.toMatchObject({ status: 400 });
  });

  it('detalle: composición por categoría/sexo y peso promedio', async () => {
    const lot: any = await herd.createLot({ name: 'Rodeo Detalle' });
    await mkAnimal('F', vacaCat, lot.id, 400);
    await mkAnimal('F', vacaCat, lot.id, 500);
    await mkAnimal('M', toroCat, lot.id, 800);
    const detail: any = await herd.getLot(lot.id);
    expect(detail.head).toBe(3);
    expect(detail.avg_weight_kg).toBe(567); // (400+500+800)/3 = 566.67 → 567
    expect(detail.by_sex.find((s: any) => s.sex === 'F').n).toBe(2);
    expect(detail.by_sex.find((s: any) => s.sex === 'M').n).toBe(1);
    expect(detail.by_category.find((c: any) => c.category === 'Vaca').n).toBe(2);
  });

  it('edita nombre, propósito y estado (el potrero NO se edita como campo: es rotación)', async () => {
    const lot: any = await herd.createLot({ name: 'Rodeo Editar' });
    const upd: any = await herd.updateLot(lot.id, { name: 'Rodeo Editado', purpose: 'fattening', is_active: false });
    expect(upd.name).toBe('Rodeo Editado');
    expect(upd.purpose).toBe('fattening');
    expect(upd.is_active).toBe(false);
    // Regla #4: cambiar el potrero es una rotación (land.moveLot), no una edición de campo.
    // updateLot ignora current_paddock_id; sin otros cambios queda sin nada para actualizar → 400.
    await expect(herd.updateLot(lot.id, { current_paddock_id: paddockId })).rejects.toMatchObject({ status: 400 });
  });

  it('archiva un lote vacío pero bloquea uno con animales', async () => {
    const lot: any = await herd.createLot({ name: 'Rodeo Ocupado' });
    const animal = await mkAnimal('F', vacaCat, lot.id, 420);
    await expect(herd.deleteLot(lot.id)).rejects.toMatchObject({ status: 409 });
    await db.query(`UPDATE animals SET current_lot_id=NULL WHERE id=$1`, [animal]);
    await expect(herd.deleteLot(lot.id)).resolves.toMatchObject({ deleted: true });
    const list: any[] = await herd.lots();
    expect(list.some((x) => x.id === lot.id)).toBe(false);
  });
});
