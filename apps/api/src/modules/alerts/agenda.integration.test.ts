import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AlertsService } from './alerts.service';

/**
 * Integración de la agenda diaria (P4-1): `agenda()` reutiliza `computeDesired()`
 * (fuente única de reglas) y da forma estructurada (due_at + acción + caravana),
 * excluyendo los ítems de sistema (sync). Se siembra un caso determinista (preñez
 * vencida) sobre la base demo. Providers instanciados manualmente (ver P2/P3).
 */
describe('AlertsService.agenda · integración', () => {
  let db: DbService;
  let alerts: AlertsService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'agenda-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    alerts = new AlertsService(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const ACTIONS = new Set(['vaccinate', 'review_pregnancy', 'view_animal', 'complete_task']);

  it('estructura los hechos accionables (due_at, acción, caravana), excluye sistema y ordena', async () => {
    // Caso determinista: animal con caravana + preñez vencida (parto probable en el pasado).
    const tag = `AGENDA-${Date.now()}`;
    const animalId = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F','active','born') RETURNING id`,
        [tenantId, farmId, speciesId],
      )
    )[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, animalId, tag]);
    await db.query(
      `INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, expected_due_date, status) VALUES ($1,$2, CURRENT_DATE - 60, CURRENT_DATE - 5, 'open')`,
      [tenantId, animalId],
    );

    const items = await alerts.agenda();

    // El ítem sembrado aparece, estructurado y accionable.
    const mine = items.find((i) => i.related_id === animalId);
    expect(mine).toBeTruthy();
    expect(mine).toMatchObject({ code: 'pregnancy_overdue', category: 'reproduction', severity: 'warning', action: 'review_pregnancy', tag });
    expect(mine!.due_at).toBeTruthy(); // vencimiento estructurado (ISO)
    expect(new Date(mine!.due_at!).toISOString()).toBe(mine!.due_at); // es ISO válido

    // Ningún ítem de sistema (sync) en la agenda; toda acción es del set conocido.
    expect(items.every((i) => i.category === 'health' || i.category === 'reproduction')).toBe(true);
    expect(items.every((i) => ACTIONS.has(i.action))).toBe(true);

    // Orden por due_at ascendente (null al final).
    const keys = items.map((i) => i.due_at ?? '9999-12-31');
    for (let n = 1; n < keys.length; n++) expect(keys[n - 1] <= keys[n]).toBe(true);
  });

  it('read-through: evaluate() sigue funcionando con los campos extra del Desired', async () => {
    const r = await alerts.evaluate();
    expect(r).toHaveProperty('created');
    expect(r).toHaveProperty('resolved');
  });
});
