import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../weather/weather.service';
import { AlertsService } from './alerts.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Motor de reglas declarativas (A3): las reglas de alerta pasan a ser configurables por tenant
 * (activa/inactiva + umbral en días) y `computeDesired` las LEE. Se prueba que el comportamiento cambia
 * con la config: una vacuna a +20 días entra con umbral 30 pero no con 10, y desaparece si la regla se
 * apaga. Animal y vacuna controlados para aislar de los datos demo.
 */
describe('alerts — motor de reglas configurable', () => {
  let db: DbService;
  let svc: AlertsService;
  let originalCwd: string;
  let tmp: string;
  let animalId: string;

  const openVaccinationAlerts = async () =>
    (await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alerts a JOIN alert_rules r ON r.id=a.rule_id
       WHERE a.tenant_id=$1 AND r.condition->>'code'='vaccination_due' AND a.related_id=$2 AND a.status='open' AND a.deleted_at IS NULL`,
      [db.tenant, animalId],
    ))[0].n;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'alert-rules-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    const t = db.tenant;
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [t]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    const productId = (await db.query<{ id: string }>(`SELECT id FROM products_veterinary WHERE tenant_id=$1 LIMIT 1`, [t]))[0].id;
    animalId = (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'F','active') RETURNING id`,
      [t, farmId, speciesId],
    ))[0].id;
    // Vacuna con próxima dosis a +20 días.
    const due = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    await db.query(`INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at, next_due_date) VALUES ($1,$2,$3,now(),$4)`, [t, animalId, productId, due]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('listRules expone las reglas con estado y umbral', async () => {
    const rules: any[] = await svc.listRules();
    expect(rules.length).toBeGreaterThanOrEqual(12); // health/sync + reproducción (E1: +5)
    expect(rules.find((r) => r.code === 'vwp_ready')?.days).toBe(60); // VWP configurable
    const vac = rules.find((r) => r.code === 'vaccination_due');
    expect(vac.is_active).toBe(true);
    expect(vac.days).toBe(30);
    expect(vac.param_label).toBeTruthy();
    const wd = rules.find((r) => r.code === 'withdrawal_active');
    expect(wd.days).toBeNull(); // regla sin parámetro
  });

  it('el umbral configurado cambia la evaluación (10 no dispara, 30 sí)', async () => {
    await svc.updateRule('vaccination_due', { is_active: true, days: 10 });
    await svc.evaluate();
    expect(await openVaccinationAlerts()).toBe(0); // +20 días fuera de la ventana de 10

    await svc.updateRule('vaccination_due', { is_active: true, days: 30 });
    await svc.evaluate();
    expect(await openVaccinationAlerts()).toBe(1); // +20 días dentro de la ventana de 30
  });

  it('apagar la regla auto-resuelve sus alertas', async () => {
    await svc.updateRule('vaccination_due', { is_active: false });
    await svc.evaluate();
    expect(await openVaccinationAlerts()).toBe(0);
  });

  it('valida el umbral (400) y el código de regla (404)', async () => {
    await expect(svc.updateRule('vaccination_due', { is_active: true, days: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateRule('no_existe', { is_active: true })).rejects.toMatchObject({ status: 404 });
  });
});
