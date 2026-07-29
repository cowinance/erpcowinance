import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';
import { LandService } from './land.service';

/**
 * Editor de mapas (D3): alta/edición/baja de potreros con geometría. La superficie se DERIVA del
 * polígono dibujado (shoelace, regla única del dominio), y la baja se bloquea si hay animales.
 */
describe('LandService — editor de potreros', () => {
  let db: DbService;
  let land: LandService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  const square = (s: number) => ({ type: 'Polygon', coordinates: [[[0, 0], [s, 0], [s, s], [0, s]]] });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'paddock-editor-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un potrero con forma y deriva la superficie del polígono', async () => {
    const p: any = await land.createPaddock({ name: 'Editor 1', pasture_type: 'natural', boundary: square(100) });
    expect(p.area_ha).toBe(9); // 100×100 u² × 3² m²/u² = 9 ha
    expect(p.boundary.coordinates[0]).toHaveLength(4);
    const list: any[] = await land.paddocks();
    expect(list.some((x) => x.id === p.id && x.boundary?.coordinates?.length)).toBe(true);
  });

  it('editar la forma re-deriva la superficie; editar props no la toca', async () => {
    const p: any = await land.createPaddock({ name: 'Editor 2', boundary: square(100) });
    const bigger: any = await land.updatePaddock(p.id, { boundary: square(200) });
    expect(bigger.area_ha).toBe(36); // 200×200 × 9 = 36 ha
    const renamed: any = await land.updatePaddock(p.id, { name: 'Editor 2 bis', pasture_type: 'alfalfa' });
    expect(renamed.name).toBe('Editor 2 bis');
    expect(renamed.area_ha).toBe(36); // sin tocar la forma, el área queda
  });

  it('LA SUPERFICIE DE UN POTRERO DIBUJADO NO SE ESCRIBE A MANO', async () => {
    // El alta ya lo hacía —mandar `area_ha` con un polígono no tenía efecto, ganaba lo medido— pero
    // la edición dejaba pisarlo después, y las dos versiones convivían sin que nada las comparara:
    // 500 ha declaradas sobre un polígono de 9. De ese número salen la carga del mapa y los kg/ha
    // del rendimiento, así que la que mandaba era la escrita a mano.
    const p: any = await land.createPaddock({ name: 'DER dibujado', boundary: square(100), area_ha: 999 });
    expect(p.area_ha, 'al crear, el dibujo ya le ganaba al número mandado').toBe(9);

    await expect(land.updatePaddock(p.id, { area_ha: 500 })).rejects.toMatchObject({
      status: 409,
      response: { code: 'paddock.area_is_derived' },
    });
    const sigue: any = await land.updatePaddock(p.id, { name: 'DER dibujado bis' });
    expect(sigue.area_ha, 'y la superficie quedó intacta').toBe(9);
  });

  it('un potrero SIN dibujar sí declara su superficie, y se puede corregir', async () => {
    // La otra mitad: no todo potrero está mapeado, y el que no lo está tiene que poder decir cuánto
    // mide. La regla es «no contradigas al dibujo», no «no declares».
    const p: any = await land.createPaddock({ name: 'DEC sin dibujo', area_ha: 45.5 });
    expect(p.area_ha).toBe(45.5);
    const corregido: any = await land.updatePaddock(p.id, { area_ha: 60 });
    expect(corregido.area_ha).toBe(60);
  });

  it('una superficie que no puede serlo se rechaza, y un dibujo fuera de escala no rompe', async () => {
    // La negativa daba carga animal negativa; el texto se guardaba como `null` sin avisar. Y el
    // polígono gigante contestaba 500 crudo: el área derivada iba directo a una columna
    // `numeric(14,3)` sin que nadie la mirara.
    await expect(land.createPaddock({ name: 'MAL neg', area_ha: -50 })).rejects.toMatchObject({ status: 400 });
    await expect(land.createPaddock({ name: 'MAL cero', area_ha: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(land.createPaddock({ name: 'MAL txt', area_ha: 'muchas' })).rejects.toMatchObject({ status: 400 });
    await expect(
      land.createPaddock({ name: 'MAL escala', boundary: [[0, 0], [1e9, 0], [1e9, 1e9], [0, 1e9]] }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'paddock.invalid_boundary' } });
  });

  it('DOS POTREROS NO PUEDEN LLAMARSE IGUAL', async () => {
    // En una finca el potrero se nombra en voz alta —«llevá el rodeo al Norte»— así que dos con el
    // mismo nombre no se distinguen en ningún selector de destino, y mover un lote al equivocado no
    // deja ninguna señal.
    await land.createPaddock({ name: 'DUP Norte' });
    await expect(land.createPaddock({ name: 'DUP Norte' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'paddock.duplicate_name' },
    });
    // Se compara sin mayúsculas ni espacios de sobra: así es como se repite un nombre por error.
    await expect(land.createPaddock({ name: '  dup norte ' })).rejects.toMatchObject({ status: 409 });
  });

  it('renombrar un potrero no choca CONSIGO MISMO', async () => {
    // La otra mitad: la guarda no puede impedir editar el resto de un potrero sin cambiarle el
    // nombre, ni volver a ponerle el que ya tenía.
    const p: any = await land.createPaddock({ name: 'DUP propio' });
    const r: any = await land.updatePaddock(p.id, { name: 'DUP propio', pasture_type: 'alfalfa' });
    expect(r.pasture_type).toBe('alfalfa');
  });

  it('NO SE BORRA UN POTRERO CON UN LOTE ADENTRO, aunque esté vacío de animales', async () => {
    // La guarda contaba cabezas nomás, así que un potrero con un lote vacío se borraba sin más y el
    // lote quedaba apuntando a algo que ya no existe. Comprobado contra la app: «Cuarentena» siguió
    // mostrando «Bajo Grande» después de borrarlo.
    const pad: any = await land.createPaddock({ name: 'DEL con lote' });
    const lote = (await db.query<{ id: string }>(
      `INSERT INTO lots (tenant_id, farm_id, name, current_paddock_id) VALUES ($1,$2,'DEL lote',$3) RETURNING id`,
      [db.tenant, farmId, pad.id],
    ))[0].id;

    await expect(land.deletePaddock(pad.id)).rejects.toMatchObject({ status: 409, response: { code: 'paddock.has_lots' } });

    // Sacado el lote, se borra sin problema: la guarda no bloquea el caso legítimo.
    await db.query(`UPDATE lots SET current_paddock_id=NULL WHERE id=$1`, [lote]);
    expect(((await land.deletePaddock(pad.id)) as any).deleted).toBe(true);
  });

  it('rechaza una geometría inválida (< 3 vértices)', async () => {
    await expect(land.createPaddock({ name: 'Malo', boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } })).rejects.toMatchObject({ status: 400 });
  });

  it('borra un potrero vacío pero bloquea uno con animales', async () => {
    const empty: any = await land.createPaddock({ name: 'Vacío', boundary: square(50) });
    await expect(land.deletePaddock(empty.id)).resolves.toMatchObject({ deleted: true });
    const list: any[] = await land.paddocks();
    expect(list.some((x) => x.id === empty.id)).toBe(false);

    const occupied: any = await land.createPaddock({ name: 'Ocupado', boundary: square(60) });
    await db.query(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_paddock_id) VALUES ($1,$2,$3,'F','active',$4)`,
      [db.tenant, farmId, speciesId, occupied.id],
    );
    await expect(land.deletePaddock(occupied.id)).rejects.toMatchObject({ status: 409 });
  });
});
