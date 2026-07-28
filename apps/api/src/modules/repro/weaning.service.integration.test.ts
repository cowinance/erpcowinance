import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { WeaningService } from './weaning.service';

/**
 * Integración del núcleo neutral de destete (P5-1.c) sobre PGlite en un directorio
 * temporal aislado. Verifica que un destete produce EXACTAMENTE: una fila weanings,
 * el pesaje asociado con IDENTIDAD DETERMINISTA (=weaningId) sólo si hay peso, un evento
 * weaning de timeline; SIN put ni changeset server-origin (fact-only); idempotencia por
 * weaningId (sin duplicar destete/pesaje/timeline); y rechazo (animal inexistente) sin
 * persistencia parcial.
 */
describe('WeaningService · integración', () => {
  let db: DbService;
  let weaning: WeaningService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `WEAN-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'weaning-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    weaning = new WeaningService(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(tag?: string): Promise<string> {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','active','born') RETURNING id`,
        [tenantId, farmId, speciesId],
      )
    )[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  }
  const weanRows = async (id: string) => db.query<any>(`SELECT id, weaning_date, weaning_weight_kg FROM weanings WHERE animal_id = $1`, [id]);
  const weighRows = async (id: string) => db.query<any>(`SELECT id, weight_kg FROM weighings WHERE animal_id = $1`, [id]);
  const weanEvents = async (id: string) => db.query<any>(`SELECT payload FROM animal_events WHERE animal_id = $1 AND event_type = 'weaning'`, [id]);
  const changesetsFor = async (wid: string) =>
    db.query<any>(`SELECT origin_ref FROM sync_changesets WHERE source = 'server' AND origin_ref = $1`, [`weaning:${wid}`]);

  it('UN ANIMAL SE DESTETA UNA SOLA VEZ', async () => {
    // La idempotencia por id cubre el reintento del MISMO registro; esto cubre lo otro: dos cargas
    // distintas del mismo destete, que pasa cuando lo anotan dos personas o se recarga una planilla.
    // El daño va directo a los números: en la auditoría, tres destetes de un animal dieron una tasa
    // de destete del 300% y le duplicaron los kilos a la madre.
    const a = await animal(uniq('UNO'));
    await db.tx((q) => weaning.recordWeaning(q, { animalId: a, weightKg: 180, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' }));
    await expect(
      db.tx((q) => weaning.recordWeaning(q, { animalId: a, weightKg: 190, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' })),
    ).rejects.toMatchObject({ response: { code: 'weaning.already_weaned' } });
    expect(await weanRows(a)).toHaveLength(1);
  });

  it('EL PESO TIENE QUE SER UN PESO', async () => {
    // Un negativo entraba y contaminaba el promedio del período y los kilos destetados de la madre.
    // Un cero no distingue «pesó cero» de «no se pesó», y esas dos cosas sí se distinguen: para no
    // pesarlo, se omite el campo.
    const a = await animal(uniq('PESO'));
    for (const kg of [-50, 0]) {
      await expect(
        db.tx((q) => weaning.recordWeaning(q, { animalId: a, weightKg: kg, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' })),
      ).rejects.toMatchObject({ response: { code: 'weaning.invalid_weight' } });
    }
    expect(await weanRows(a)).toHaveLength(0);
  });

  it('sin peso sigue siendo válido: no pesarlo es distinto de pesar cero', async () => {
    const a = await animal(uniq('SINPESO'));
    const r = await db.tx((q) => weaning.recordWeaning(q, { animalId: a, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' }));
    expect(r.recorded).toBe(true);
  });

  it('NO SE DESTETA ANTES DE NACER NI EN EL FUTURO', async () => {
    // La evaluación de toros ya descartaba estos casos al leer —los cuenta como «datos
    // imposibles»—, pero descartar al leer no arregla el dato: queda ahí, contando en el hato.
    const a = await animal(uniq('FECHA'));
    await db.query(`UPDATE animals SET birth_date = '2025-06-01' WHERE id = $1`, [a]);

    await expect(
      db.tx((q) => weaning.recordWeaning(q, { animalId: a, weaningDate: '2025-01-10', weightKg: 190, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' })),
    ).rejects.toMatchObject({ response: { code: 'weaning.before_birth' } });

    await expect(
      db.tx((q) => weaning.recordWeaning(q, { animalId: a, weaningDate: '2099-01-10', weightKg: 190, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' })),
    ).rejects.toMatchObject({ response: { code: 'weaning.future_date' } });

    // Y el válido entra: la guarda no puede frenar un destete normal.
    const ok = await db.tx((q) => weaning.recordWeaning(q, { animalId: a, weaningDate: '2026-01-10', weightKg: 190, weaningId: randomUUID(), actorUserId: userId, origin: 'rest' }));
    expect(ok.recorded).toBe(true);
  });

  it('destete con peso: una fila weanings, un pesaje con id=weaningId, un timeline; sin changeset server-origin', async () => {
    const tag = uniq('T');
    const a = await animal(tag);
    const wid = randomUUID();
    const res = await db.tx((q) =>
      weaning.recordWeaning(q, { animalId: a, weightKg: 180, weaningId: wid, actorUserId: userId, origin: 'rest' }),
    );
    expect(res.recorded).toBe(true);
    expect(res.tag).toBe(tag);

    const w = await weanRows(a);
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe(wid);
    expect(Number(w[0].weaning_weight_kg)).toBe(180);

    const wg = await weighRows(a);
    expect(wg).toHaveLength(1);
    expect(wg[0].id).toBe(wid); // identidad determinista = weaningId
    expect(Number(wg[0].weight_kg)).toBe(180);

    expect(await weanEvents(a)).toHaveLength(1);
    // Fact-only: no se emite changeset server-origin.
    expect(await changesetsFor(wid)).toHaveLength(0);
  });

  it('destete sin peso: una fila weanings y un timeline, SIN pesaje', async () => {
    const a = await animal();
    const wid = randomUUID();
    await db.tx((q) => weaning.recordWeaning(q, { animalId: a, weaningId: wid, actorUserId: userId, origin: 'rest' }));
    expect(await weanRows(a)).toHaveLength(1);
    expect(await weighRows(a)).toHaveLength(0);
    expect(await weanEvents(a)).toHaveLength(1);
  });

  it('reproceso con el mismo weaningId → no-op idempotente, sin duplicar destete/pesaje/timeline', async () => {
    const a = await animal();
    const wid = randomUUID();
    const input = { animalId: a, weightKg: 200, weaningId: wid, actorUserId: userId, origin: 'rest' as const };
    const first = await db.tx((q) => weaning.recordWeaning(q, input));
    expect(first.recorded).toBe(true);

    const again = await db.tx((q) => weaning.recordWeaning(q, input));
    expect(again.recorded).toBe(false);
    expect(again.alreadyRecorded).toBe(true);

    expect(await weanRows(a)).toHaveLength(1);
    expect(await weighRows(a)).toHaveLength(1);
    expect(await weanEvents(a)).toHaveLength(1);
  });

  it('animal inexistente → rechazo animal.not_found', async () => {
    await expect(
      db.tx((q) => weaning.recordWeaning(q, { animalId: randomUUID(), weaningId: randomUUID(), actorUserId: userId, origin: 'rest' })),
    ).rejects.toMatchObject({ response: { code: 'animal.not_found' } });
  });
});
