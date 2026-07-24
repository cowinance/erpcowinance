import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AnimalWriteService } from './animal-write.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { ANIMAL_IMPORT_DESCRIPTOR } from './animal-import-descriptor';

/**
 * Auditoría Fase 3c — el alta por PLANILLA acepta lo mismo que el alta manual: raza, RFID,
 * ID oficial y lote (por NOMBRE, como viene en un Excel real). `checkAgainstDb` resuelve los
 * nombres a ids y rechaza la fila si el nombre no existe o el identificador ya está en uso;
 * `persistNewAnimal` escribe raza + identificadores + lote. Nada de esto se creaba antes.
 */
describe('Importación de animales — raza / RFID / oficial / lote (Fase 3c)', () => {
  let db: DbService;
  let writer: AnimalWriteService;
  let originalCwd: string;
  let tmp: string;
  let lotId: string;

  const persist = (raw: any) =>
    db.tx(async (q) => {
      const nv = writer.normalizeAndValidate(raw);
      if (!nv.ok) return { failed: nv.errors };
      const check = await writer.checkAgainstDb(q, nv.input);
      if ('skip' in check) return { skipped: check.skip };
      if (!check.ok) return { failed: check.errors };
      const { animalId } = await writer.persistNewAnimal(
        q,
        nv.input,
        { origin: 'import', actorUserId: db.user, timeline: { eventType: 'birth', source: 'import' }, sync: 'none' },
        check.resolved,
      );
      return { animalId };
    });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'import-ext-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    lotId = (await db.query<{ id: string }>(`SELECT id FROM lots WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    // PGlite tiene UNA conexión: `persistNewAnimal` llama `db.defaultFarm()`, que si no está
    // cacheada consultaría por fuera de la tx y se bloquearía. Se precalienta acá (en la app real
    // la request trae su propio `q` en el contexto).
    await db.defaultFarm();
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('el descriptor expone los campos nuevos con sinónimos en español', () => {
    const fields = ANIMAL_IMPORT_DESCRIPTOR.fields.map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['breed', 'rfid', 'official_id', 'lot']));
    const breed = ANIMAL_IMPORT_DESCRIPTOR.fields.find((f) => f.field === 'breed')!;
    expect(breed.required).toBe(false);
    expect(breed.synonyms).toContain('raza');
    // Sinónimos reales de planillas de campo.
    expect(ANIMAL_IMPORT_DESCRIPTOR.fields.find((f) => f.field === 'rfid')!.synonyms).toContain('caravana electronica');
    expect(ANIMAL_IMPORT_DESCRIPTOR.fields.find((f) => f.field === 'lot')!.synonyms).toContain('rodeo');
  });

  it('importa una fila completa: crea raza, RFID, ID oficial y asigna el lote por nombre', async () => {
    const lotName = (await db.query<{ name: string }>(`SELECT name FROM lots WHERE id=$1`, [lotId]))[0].name;
    const breedName = (await db.query<{ name: string }>(`SELECT name FROM breeds WHERE deleted_at IS NULL LIMIT 1`))[0].name;

    const res: any = await persist({
      tag: 'IMP-100', sex: 'F', category_code: 'vaca',
      breed: breedName.toUpperCase(), // el match es case-insensitive, como en una planilla real
      rfid: 'RF-IMP-100', official_id: 'OF-IMP-100', lot: lotName,
    });
    expect(res.animalId).toBeTruthy();

    const a = (await db.query<any>(`SELECT current_lot_id FROM animals WHERE id=$1`, [res.animalId]))[0];
    expect(a.current_lot_id).toBe(lotId);

    const ids = await db.query<any>(`SELECT type, value, is_official FROM animal_identifiers WHERE animal_id=$1 ORDER BY type`, [res.animalId]);
    expect(ids.find((i: any) => i.type === 'rfid')?.value).toBe('RF-IMP-100');
    const official = ids.find((i: any) => i.type === 'official');
    expect(official?.value).toBe('OF-IMP-100');
    expect(official?.is_official).toBe(true); // el oficial queda marcado como tal
    expect(ids.find((i: any) => i.type === 'visual')?.value).toBe('IMP-100');

    const breeds = await db.query<any>(`SELECT breed_id FROM animal_breeds WHERE animal_id=$1`, [res.animalId]);
    expect(breeds).toHaveLength(1);
  });

  it('rechaza la fila (sin crear el animal) si la raza o el lote no existen', async () => {
    const badBreed: any = await persist({ tag: 'IMP-101', sex: 'F', category_code: 'vaca', breed: 'Raza Inventada' });
    expect(badBreed.failed?.[0]).toMatchObject({ field: 'breed', code: 'not_found' });

    const badLot: any = await persist({ tag: 'IMP-102', sex: 'F', category_code: 'vaca', lot: 'Lote Fantasma' });
    expect(badLot.failed?.[0]).toMatchObject({ field: 'lot', code: 'not_found' });

    // Ninguno de los dos se creó.
    const n = (await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM animal_identifiers WHERE value = ANY(ARRAY['IMP-101','IMP-102'])`,
    ))[0].n;
    expect(n).toBe(0);
  });

  it('rechaza RFID / ID oficial ya usados por otro animal activo', async () => {
    const dupRfid: any = await persist({ tag: 'IMP-103', sex: 'F', category_code: 'vaca', rfid: 'RF-IMP-100' });
    expect(dupRfid.failed?.[0]).toMatchObject({ field: 'rfid', code: 'duplicate' });

    const dupOfficial: any = await persist({ tag: 'IMP-104', sex: 'F', category_code: 'vaca', official_id: 'OF-IMP-100' });
    expect(dupOfficial.failed?.[0]).toMatchObject({ field: 'official_id', code: 'duplicate' });
  });

  it('los campos nuevos son OPCIONALES: una fila mínima sigue importando igual', async () => {
    const res: any = await persist({ tag: 'IMP-105', sex: 'M', category_code: 'toro' });
    expect(res.animalId).toBeTruthy();
    const ids = await db.query<any>(`SELECT type FROM animal_identifiers WHERE animal_id=$1`, [res.animalId]);
    expect(ids).toHaveLength(1); // solo el visual
    const breeds = await db.query<any>(`SELECT 1 FROM animal_breeds WHERE animal_id=$1`, [res.animalId]);
    expect(breeds).toHaveLength(0);
  });
});
