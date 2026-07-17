import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MortalityService } from './mortality.service';
import { TreatmentService } from './treatment.service';
import { VaccinationService } from './vaccination.service';
import { HealthService } from './health.service';

/**
 * Sanidad E1 — núcleo neutral de vacunaciones + adaptador REST de aplicación masiva.
 * Verifica: fila + timeline por vacuna; idempotencia por vaccinationId; rechazo de
 * producto que no es vacuna y de animal no activo; y que la vacunación de lote por REST
 * es idempotente por Idempotency-Key (reintentar la misma request no duplica ninguna fila).
 */
describe('VaccinationService · integración', () => {
  let db: DbService;
  let svc: VaccinationService;
  let health: HealthService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let vaccineId: string;
  let antibioticId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `VAC-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'vaccination-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new VaccinationService(db);
    const mortality = new MortalityService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    health = new HealthService(db, mortality, new TreatmentService(db), svc);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    vaccineId = (await db.query<{ id: string }>(
      `INSERT INTO products_veterinary (tenant_id, name, type, created_by) VALUES ($1,'Aftosa','vaccine',$2) RETURNING id`, [tenantId, userId],
    ))[0].id;
    antibioticId = (await db.query<{ id: string }>(
      `INSERT INTO products_veterinary (tenant_id, name, type, created_by) VALUES ($1,'Penicilina','antibiotic',$2) RETURNING id`, [tenantId, userId],
    ))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(status = 'active', tag?: string): Promise<string> {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F',$4,'born') RETURNING id`,
        [tenantId, farmId, speciesId, status],
      )
    )[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  }
  const vacRows = (id: string) => db.query<any>(`SELECT id, next_due_date FROM vaccinations WHERE animal_id = $1`, [id]);
  const vacEvents = (id: string) => db.query<any>(`SELECT payload FROM animal_events WHERE animal_id = $1 AND event_type = 'vaccination'`, [id]);

  it('registra: fila + timeline con próximo refuerzo', async () => {
    const a = await animal('active', uniq('T'));
    const res = await db.tx((q) =>
      svc.recordVaccination(q, { animalId: a, productId: vaccineId, nextDueDate: '2031-01-01', actorUserId: userId, origin: 'rest', vaccinationId: randomUUID() }),
    );
    expect(res.recorded).toBe(true);
    expect(res.nextDueDate).toBe('2031-01-01');
    expect(await vacRows(a)).toHaveLength(1);
    expect(await vacEvents(a)).toHaveLength(1);
  });

  it('idempotente por vaccinationId', async () => {
    const a = await animal();
    const vid = randomUUID();
    const input = { animalId: a, productId: vaccineId, actorUserId: userId, origin: 'rest' as const, vaccinationId: vid };
    await db.tx((q) => svc.recordVaccination(q, input));
    const again = await db.tx((q) => svc.recordVaccination(q, input));
    expect(again.alreadyRecorded).toBe(true);
    expect(await vacRows(a)).toHaveLength(1);
    expect(await vacEvents(a)).toHaveLength(1);
  });

  it('producto que no es vacuna → product.wrong_type', async () => {
    const a = await animal();
    await expect(
      db.tx((q) => svc.recordVaccination(q, { animalId: a, productId: antibioticId, actorUserId: userId, origin: 'rest', vaccinationId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'product.wrong_type' });
    expect(await vacRows(a)).toHaveLength(0);
  });

  it('animal muerto → animal.not_treatable', async () => {
    const a = await animal('dead');
    await expect(
      db.tx((q) => svc.recordVaccination(q, { animalId: a, productId: vaccineId, actorUserId: userId, origin: 'rest', vaccinationId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'animal.not_treatable' });
  });

  it('REST masivo: mismo Idempotency-Key reaplicado NO duplica ninguna fila', async () => {
    const a1 = await animal('active', uniq('M1'));
    const a2 = await animal('active', uniq('M2'));
    const key = randomUUID();
    const first: any = await health.vaccinate({ animal_ids: [a1, a2], product_id: vaccineId }, key);
    expect(first.applied).toBe(2);
    const second: any = await health.vaccinate({ animal_ids: [a1, a2], product_id: vaccineId }, key);
    expect(second.results.every((r: any) => r.alreadyRecorded)).toBe(true);
    expect(await vacRows(a1)).toHaveLength(1);
    expect(await vacRows(a2)).toHaveLength(1);
  });
});
