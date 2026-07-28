import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { TreatmentService } from './treatment.service';

/**
 * Sanidad E1 — núcleo neutral de tratamientos. Verifica que UN tratamiento produce
 * EXACTAMENTE: una fila treatments con el retiro DERIVADO por dominio, un evento
 * 'treatment' de timeline y un evento de dominio en event_outbox; idempotencia por
 * treatmentId; rechazo de animal no activo / producto inexistente sin persistencia
 * parcial; y Server Authority sobre el retiro (mismatch reportado, valor del servidor).
 */
describe('TreatmentService · integración', () => {
  let db: DbService;
  let svc: TreatmentService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let productId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `TRT-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'treatment-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new TreatmentService(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    productId = (
      await db.query<{ id: string }>(
        `INSERT INTO products_veterinary (tenant_id, name, type, withdrawal_meat_days, withdrawal_milk_hours, created_by)
         VALUES ($1,'Oxitetraciclina','antibiotic',28,72,$2) RETURNING id`,
        [tenantId, userId],
      )
    )[0].id;
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
  const trtRows = (id: string) => db.query<any>(`SELECT id, meat_withdrawal_until::text AS meat_withdrawal_until, milk_withdrawal_until, diagnosis_id FROM treatments WHERE animal_id = $1`, [id]);
  const trtEvents = (id: string) => db.query<any>(`SELECT payload FROM animal_events WHERE animal_id = $1 AND event_type = 'treatment'`, [id]);
  const outbox = (tid: string) => db.query<any>(`SELECT id, type FROM event_outbox WHERE payload->>'treatmentId' = $1`, [tid]);

  it('registra: fila con retiro derivado + timeline + evento de dominio', async () => {
    const a = await animal('active', uniq('T'));
    const tid = randomUUID();
    const res = await db.tx((q) =>
      svc.recordTreatment(q, { animalId: a, productId, appliedAt: '2026-06-01T00:00:00.000Z', actorUserId: userId, origin: 'rest', treatmentId: tid }),
    );
    expect(res.recorded).toBe(true);
    expect(res.meatWithdrawalUntil).toBe('2026-06-28'); // +28 días desde el día de FINCA: medianoche UTC del 1 es el 31 de mayo en Caracas
    expect(res.milkWithdrawalUntil).toBe('2026-06-04T00:00:00.000Z'); // +72 horas

    const rows = await trtRows(a);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(tid);
    expect(await trtEvents(a)).toHaveLength(1);
    expect(await outbox(tid)).toHaveLength(1);
  });

  it('reproceso con el mismo treatmentId → no-op idempotente, sin duplicar', async () => {
    const a = await animal();
    const tid = randomUUID();
    const input = { animalId: a, productId, actorUserId: userId, origin: 'rest' as const, treatmentId: tid };
    await db.tx((q) => svc.recordTreatment(q, input));
    const again = await db.tx((q) => svc.recordTreatment(q, input));
    expect(again.alreadyRecorded).toBe(true);
    expect(await trtRows(a)).toHaveLength(1);
    expect(await trtEvents(a)).toHaveLength(1);
    expect(await outbox(tid)).toHaveLength(1);
  });

  it('animal muerto → rechazo animal.not_treatable sin persistencia parcial', async () => {
    const a = await animal('dead', uniq('D'));
    const tid = randomUUID();
    await expect(
      db.tx((q) => svc.recordTreatment(q, { animalId: a, productId, actorUserId: userId, origin: 'rest', treatmentId: tid })),
    ).rejects.toMatchObject({ code: 'animal.not_treatable' });
    expect(await trtRows(a)).toHaveLength(0);
    expect(await outbox(tid)).toHaveLength(0);
  });

  it('producto inexistente → rechazo product.not_found', async () => {
    const a = await animal();
    await expect(
      db.tx((q) => svc.recordTreatment(q, { animalId: a, productId: randomUUID(), actorUserId: userId, origin: 'rest', treatmentId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'product.not_found' });
  });

  it('Server Authority: retiro propuesto por el cliente distinto → mismatch reportado, valor del servidor persistido', async () => {
    const a = await animal();
    const tid = randomUUID();
    const res = await db.tx((q) =>
      svc.recordTreatment(q, {
        animalId: a, productId, appliedAt: '2026-06-01T00:00:00.000Z', actorUserId: userId, origin: 'sync', treatmentId: tid,
        clientMeatWithdrawalUntil: '2026-06-10', // cliente mintió
      }),
    );
    expect(res.withdrawalMismatch.some((m) => m.field === 'meat_withdrawal_until')).toBe(true);
    const rows = await trtRows(a);
    expect(rows[0].meat_withdrawal_until).toBe('2026-06-28'); // el servidor manda
  });
});
