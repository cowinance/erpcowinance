import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Modo Manga E1 — lookup enriquecido: la tarjeta robusta llega en una sola query
 * (ubicación, último peso/CC/GDP, días desde pesaje, preñez, retiro activo, caso abierto).
 */
describe('HerdService.lookup — tarjeta robusta de manga (E1)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catVaca: string;
  let lot: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'manga-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    catVaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
    lot = ((await herd.createLot({ name: 'Manga L' })) as any).id;

    animalId = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id, current_lot_id, name)
         VALUES ($1,$2,$3,'F','active',$4,$5,'Manchada') RETURNING id`,
        [db.tenant, farmId, speciesId, catVaca, lot],
      )
    )[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','MG-1')`, [db.tenant, animalId]);
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'rfid','RF-MG-1')`, [db.tenant, animalId]);
    // Dos pesadas → GDP derivado + CC.
    await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2, now() - INTERVAL '30 days', 400)`, [db.tenant, animalId]);
    await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, body_condition) VALUES ($1,$2, now() - INTERVAL '5 days', 430, 3.5)`, [db.tenant, animalId]);
    // Retiro activo + caso abierto.
    await db.query(`INSERT INTO treatments (tenant_id, animal_id, applied_at, meat_withdrawal_until) VALUES ($1,$2, now(), CURRENT_DATE + 7)`, [db.tenant, animalId]);
    await db.query(`INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at) VALUES ($1,$2,'in_treatment','severe', now())`, [db.tenant, animalId]);
    // Preñez abierta.
    await db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, method, status, expected_due_date) VALUES ($1,$2, CURRENT_DATE, 'ultrasound', 'open', CURRENT_DATE + 90)`, [db.tenant, animalId]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resuelve por caravana visual con tarjeta completa', async () => {
    const r: any = await herd.lookup({ identifier: 'MG-1' });
    expect(r.id).toBe(animalId);
    expect(r.tag).toBe('MG-1');
    expect(r.name).toBe('Manchada');
    expect(r.category).toBe('Vaca');
    expect(r.lot_name).toBe('Manga L');
    expect(r.last_weight_kg).toBe(430);
    expect(r.last_body_condition).toBe(3.5);
    expect(r.days_since_weighing).toBeGreaterThanOrEqual(4);
    expect(r.adg).toBeGreaterThan(0); // 30kg en 25 días
  });

  it('resuelve también por RFID (cualquier identificador)', async () => {
    const r: any = await herd.lookup({ identifier: 'RF-MG-1' });
    expect(r.id).toBe(animalId);
    expect(r.tag).toBe('MG-1'); // devuelve siempre la caravana visual
  });

  it('incluye flags de sanidad y reproducción para las alertas', async () => {
    const r: any = await herd.lookup({ identifier: 'MG-1' });
    expect(r.has_withdrawal).toBe(true);
    expect(r.meat_withdrawal_until).toBeTruthy();
    expect(r.open_cases).toBe(1);
    expect(r.case_severity).toBe('severe');
    expect(r.expected_due_date).toBeTruthy();
  });

  it('404 si no existe', async () => {
    await expect(herd.lookup({ identifier: 'NOPE-999' })).rejects.toThrow();
  });
});
