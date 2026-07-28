import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';

/**
 * Animales E4 — identificación avanzada (múltiples tipos, oficial único, retiro con
 * historial, dedup activo por tipo), razas y alta mejorada (campos + genealogía + IDs).
 */
describe('HerdService — identificadores + razas + alta mejorada (E4)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let animalId: string;
  let breedId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'animids-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    herd = new HerdService(db, writer, new BillingService(db));
    const created: any = await herd.createAnimal({ tag: 'IDF-1', sex: 'F', category_code: 'vaca' });
    animalId = created.id;
    breedId = (await db.query<{ id: string }>(`SELECT id FROM breeds LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('agrega RFID y lo marca oficial (único por animal)', async () => {
    let res: any = await herd.addIdentifier(animalId, { type: 'rfid', value: '9820001', is_official: true });
    const rfid = res.identifiers.find((i: any) => i.type === 'rfid');
    expect(rfid.is_official).toBe(true);
    // Agregar un oficial distinto desmarca al anterior.
    res = await herd.addIdentifier(animalId, { type: 'official', value: 'AR-XYZ', is_official: true });
    const officials = res.identifiers.filter((i: any) => i.is_official && i.active);
    expect(officials).toHaveLength(1);
    expect(officials[0].type).toBe('official');
  });

  it('rechaza duplicado activo del mismo tipo', async () => {
    const other: any = await herd.createAnimal({ tag: 'IDF-2', sex: 'F', category_code: 'vaca' });
    await expect(herd.addIdentifier(other.id, { type: 'rfid', value: '9820001' })).rejects.toThrow();
    // Distinto tipo con el mismo string sí se permite (namespace por tipo).
    const ok: any = await herd.addIdentifier(other.id, { type: 'tattoo', value: '9820001' });
    expect(ok.identifiers.some((i: any) => i.type === 'tattoo' && i.value === '9820001')).toBe(true);
  });

  it('retira un identificador (queda en historial, no activo) y libera el valor', async () => {
    const a: any = await herd.addIdentifier(animalId, { type: 'brand', value: 'MARCA-1' });
    const brand = a.identifiers.find((i: any) => i.type === 'brand');
    const res: any = await herd.retireIdentifier(animalId, brand.id);
    const still = res.identifiers.find((i: any) => i.id === brand.id);
    expect(still.active).toBe(false);
    expect(still.retired_at).toBeTruthy();
    // El valor retirado se puede reutilizar en otro animal.
    const other: any = await herd.createAnimal({ tag: 'IDF-3', sex: 'F', category_code: 'vaca' });
    const reuse: any = await herd.addIdentifier(other.id, { type: 'brand', value: 'MARCA-1' });
    expect(reuse.identifiers.some((i: any) => i.type === 'brand' && i.value === 'MARCA-1')).toBe(true);
  });

  it('valida tipo de identificador', async () => {
    await expect(herd.addIdentifier(animalId, { type: 'nope', value: 'x' })).rejects.toThrow();
    await expect(herd.addIdentifier(animalId, { type: 'rfid', value: '' })).rejects.toThrow();
  });

  it('reemplaza la composición racial', async () => {
    const res: any = await herd.setBreeds(animalId, [{ breed_id: breedId, fraction: 1 }]);
    expect(res.breeds.some((b: any) => b.fraction === 1)).toBe(true);
  });

  it('alta mejorada: origen compra + RFID + color + madre válida', async () => {
    const dam: any = await herd.createAnimal({ tag: 'DAM-9', sex: 'F', category_code: 'vaca' });
    const res: any = await herd.createAnimal({
      tag: 'NEW-9',
      sex: 'M',
      category_code: 'toro',
      origin: 'purchased',
      coat_color: 'colorado',
      rfid: 'RF-NEW-9',
      dam_id: dam.id,
    });
    expect(res.origin).toBe('purchased');
    expect(res.coat_color).toBe('colorado');
    expect(res.identifiers.some((i: any) => i.type === 'rfid' && i.value === 'RF-NEW-9')).toBe(true);
    expect(res.genealogy?.dam_id).toBe(dam.id);
    // El evento de alta es 'purchase'.
    const tl: any[] = await herd.timeline(res.id);
    expect(tl.some((e) => e.event_type === 'purchase')).toBe(true);
  });

  it('alta mejorada: rechaza madre macho', async () => {
    const bull: any = await herd.createAnimal({ tag: 'BULL-9', sex: 'M', category_code: 'toro' });
    await expect(
      herd.createAnimal({ tag: 'BAD-9', sex: 'F', category_code: 'vaca', dam_id: bull.id }),
    ).rejects.toThrow();
  });
});
