import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import { AnimalIdentifiersService } from './animal-identifiers.service';
import { AnimalWriteService } from './animal-write.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';
import { LotsService } from './lots.service';
import { readFileSync } from 'fs';

/**
 * Animales E4 — identificación avanzada (múltiples tipos, oficial único, retiro con
 * historial, dedup activo por tipo), razas y alta mejorada (campos + genealogía + IDs).
 */
describe('HerdService — identificadores + razas + alta mejorada (E4)', () => {
  let db: DbService;
  let herd: HerdService;
  let lots: LotsService;
  let identifiers: AnimalIdentifiersService;
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
    const writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    herd = new HerdService(db, writer, new BillingService(db));
    lots = new LotsService(db);
    identifiers = new AnimalIdentifiersService(db, writer, herd);
    const created: any = await herd.createAnimal({ tag: 'IDF-1', sex: 'F', category_code: 'vaca' });
    animalId = created.id;
    breedId = (await db.query<{ id: string }>(`SELECT id FROM breeds LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('agrega RFID y lo marca oficial (único por animal)', async () => {
    let res: any = await identifiers.addIdentifier(animalId, { type: 'rfid', value: '9820001', is_official: true });
    const rfid = res.identifiers.find((i: any) => i.type === 'rfid');
    expect(rfid.is_official).toBe(true);
    // Agregar un oficial distinto desmarca al anterior.
    res = await identifiers.addIdentifier(animalId, { type: 'official', value: 'AR-XYZ', is_official: true });
    const officials = res.identifiers.filter((i: any) => i.is_official && i.active);
    expect(officials).toHaveLength(1);
    expect(officials[0].type).toBe('official');
  });

  it('rechaza duplicado activo del mismo tipo', async () => {
    const other: any = await herd.createAnimal({ tag: 'IDF-2', sex: 'F', category_code: 'vaca' });
    await expect(identifiers.addIdentifier(other.id, { type: 'rfid', value: '9820001' })).rejects.toThrow();
    // Distinto tipo con el mismo string sí se permite (namespace por tipo).
    const ok: any = await identifiers.addIdentifier(other.id, { type: 'tattoo', value: '9820001' });
    expect(ok.identifiers.some((i: any) => i.type === 'tattoo' && i.value === '9820001')).toBe(true);
  });

  it('retira un identificador (queda en historial, no activo) y libera el valor', async () => {
    const a: any = await identifiers.addIdentifier(animalId, { type: 'brand', value: 'MARCA-1' });
    const brand = a.identifiers.find((i: any) => i.type === 'brand');
    const res: any = await identifiers.retireIdentifier(animalId, brand.id);
    const still = res.identifiers.find((i: any) => i.id === brand.id);
    expect(still.active).toBe(false);
    expect(still.retired_at).toBeTruthy();
    // El valor retirado se puede reutilizar en otro animal.
    const other: any = await herd.createAnimal({ tag: 'IDF-3', sex: 'F', category_code: 'vaca' });
    const reuse: any = await identifiers.addIdentifier(other.id, { type: 'brand', value: 'MARCA-1' });
    expect(reuse.identifiers.some((i: any) => i.type === 'brand' && i.value === 'MARCA-1')).toBe(true);
  });

  it('valida tipo de identificador', async () => {
    await expect(identifiers.addIdentifier(animalId, { type: 'nope', value: 'x' })).rejects.toThrow();
    await expect(identifiers.addIdentifier(animalId, { type: 'rfid', value: '' })).rejects.toThrow();
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

  it('EL ALTA EN UN LOTE DEJA RASTRO: ingreso en el historial y potrero resuelto', async () => {
    // El historial del lote se arma con `animal_movements`, y el alta escribía `current_lot_id`
    // derecho en el INSERT. Resultado: los seis lotes del demo tenían 22, 24, 10 cabezas y CERO
    // movimientos. En una finca que importa su hato es peor — cada lote arranca con animales que
    // aparecieron de la nada, justo en la pantalla que se llama trazabilidad.
    //
    // Y de yapa el potrero: el INSERT ponía el lote pero no el potrero, que se DERIVA del lote y lo
    // resuelve `recordMovement`. Un animal creado en un lote quedaba sin potrero, así que no salía
    // en nada que se mire por potrero.
    const lote = await lots.createLot({ name: 'ALTA con potrero' }) as any;
    const pot = await db.one<{ id: string }>(`SELECT id FROM paddocks WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [db.tenant]);
    await db.query(`UPDATE lots SET current_paddock_id=$3 WHERE id=$1 AND tenant_id=$2`, [lote.id, db.tenant, pot!.id]);

    const nuevo: any = await herd.createAnimal({ tag: 'ALTA-1', sex: 'F', category_code: 'vaca', lot_id: lote.id });

    const hist = await lots.lotHistory(lote.id);
    expect(hist, 'el alta tiene que aparecer en el historial del lote').toHaveLength(1);
    expect(hist[0].kind).toBe('ingreso');
    expect(hist[0].from_lot, 'viene de ningún lote: es un alta').toBeNull();
    expect(hist[0].animals).toBe(1);
    expect(hist[0].reason).toBe('alta del animal');

    const a = await db.one<{ current_lot_id: string; current_paddock_id: string }>(
      `SELECT current_lot_id, current_paddock_id FROM animals WHERE id=$1 AND tenant_id=$2`, [nuevo.id, db.tenant]);
    expect(a!.current_lot_id).toBe(lote.id);
    expect(a!.current_paddock_id, 'el potrero se deriva del lote').toBe(pot!.id);
  });

  it('un alta SIN lote no inventa un movimiento', async () => {
    // La otra mitad: no todo animal nace en un lote, y un movimiento «hacia ninguna parte» ensuciaría
    // la trazabilidad con hechos que no pasaron.
    const antes = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1`, [db.tenant]);
    await herd.createAnimal({ tag: 'ALTA-2', sex: 'F', category_code: 'vaca' });
    const despues = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1`, [db.tenant]);
    expect(despues!.n).toBe(antes!.n);
  });

  it('NADIE escribe current_lot_id en el alta: lo pone el movimiento', async () => {
    // La regla del módulo —«un animal nunca cambia de lote con un UPDATE directo»— era cierta para
    // los cambios y no para el alta. Se mira el código porque el día que alguien vuelva a meter la
    // columna en el INSERT, el historial se vacía en silencio y no hay dato que lo delate.
    const src = readFileSync(join(originalCwd, 'apps/api/src/modules/herd/animal-write.service.ts'), 'utf8');
    const insert = src.slice(src.indexOf('INSERT INTO animals'), src.indexOf('RETURNING id'));
    expect(insert).not.toContain('current_lot_id');
  });
});
