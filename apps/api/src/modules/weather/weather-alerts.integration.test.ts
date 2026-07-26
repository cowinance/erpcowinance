import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AlertsService } from '../alerts/alerts.service';
import { WeatherService } from './weather.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * D4 · E2 — el clima entra al motor de alertas existente (A5).
 *
 * Lo que se prueba no es que se creen filas, sino que la CONDICIÓN sea la del dominio: el umbral
 * depende del sistema productivo, `mild` no alcanza para molestar al productor, y sin estación no
 * se inventa nada.
 */
describe('alertas de clima (D4 · E2)', () => {
  let db: DbService;
  let weather: WeatherService;
  let alerts: AlertsService;
  let tmp: string;
  let originalCwd: string;
  let stationId: string;

  const hoy = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'weather-alerts-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    weather = new WeatherService(db);
    alerts = new AlertsService(db, { statusAlerts: async () => [] } as any, weather, new NitrogenService(db, new InventoryService(db)));
    // El demo trae estación y un año de mediciones (Fase 3.2). Esta suite afirma sobre el conjunto
    // de alertas de clima, así que arranca siendo dueña del fixture: suponer la base vacía la hacía
    // romperse cada vez que el seed se enriquecía, sin que nada estuviera realmente mal.
    await db.query(`DELETE FROM sensor_readings WHERE tenant_id = $1`, [db.tenant]);
    await db.query(`DELETE FROM devices WHERE tenant_id = $1`, [db.tenant]);
    const st: any = await weather.createStation({ name: 'Casco', serial_number: 'EST-A' });
    stationId = st.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const medir = (metricas: Record<string, number>) =>
    weather.ingest({
      station_id: stationId,
      readings: Object.entries(metricas).map(([metric, value]) => ({
        metric,
        value,
        recorded_at: `${hoy}T12:00:00Z`,
      })),
    });

  const limpiar = () => db.query(`DELETE FROM sensor_readings WHERE tenant_id = $1`, [db.tenant]);
  const alertasDeClima = async () => {
    await alerts.evaluate();
    return db.query<{ title: string; severity: string; category: string }>(
      `SELECT a.title, a.severity, a.category FROM alerts a
       WHERE a.tenant_id = $1 AND a.category = 'iot' AND a.status = 'open' AND a.deleted_at IS NULL`,
      [db.tenant],
    );
  };

  it('sin estación ni mediciones no inventa una alerta "sin datos"', async () => {
    expect(await alertasDeClima()).toEqual([]);
    expect(await weather.currentConditions()).toBeNull();
  });

  // Avisar todos los días de verano entrenaría al productor a ignorar la alerta.
  it('el estrés leve NO genera alerta', async () => {
    await limpiar();
    await medir({ temp_max: 26, humidity: 55 }); // THI ~73: mild en carne
    const cond = await weather.currentConditions();
    expect(cond?.heatStress).toBe('none');
    expect(await alertasDeClima()).toEqual([]);
  });

  it('el estrés moderado avisa con severidad warning', async () => {
    await limpiar();
    await medir({ temp_max: 31, humidity: 65 }); // THI ~82: moderado en carne
    const [alerta] = await alertasDeClima();
    expect(alerta).toMatchObject({ category: 'iot', severity: 'warning' });
    expect(alerta.title).toMatch(/moderado/i);
  });

  it('el estrés severo escala a critical y dice qué hacer', async () => {
    await limpiar();
    await medir({ temp_max: 36, humidity: 75 }); // THI 91.5
    const [alerta] = await alertasDeClima();
    expect(alerta.severity).toBe('critical');
    expect(alerta.title).toMatch(/emergencia/i);
  });

  it('la helada avisa con la mínima registrada', async () => {
    await limpiar();
    await medir({ temp_min: -2, temp_max: 12 });
    const alertasHoy = await alertasDeClima();
    const helada = alertasHoy.find((a) => /helada/i.test(a.title));
    expect(helada).toBeDefined();
    expect(helada!.title).toContain('-2');
  });

  // La escala se DERIVA de si la finca ordeña. Que no sea configurable no significa que sea
  // invisible: la alerta dice cuál usó.
  it('con tambo cargado usa la escala de lechería y avisa antes', async () => {
    await limpiar();
    await medir({ temp_max: 28, humidity: 60 }); // THI ~77: mild en carne, moderado en lechería
    expect((await weather.currentConditions())?.system).toBe('beef');
    expect(await alertasDeClima()).toEqual([]);

    const animal = await db.one<{ id: string }>(
      `SELECT id FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [db.tenant],
    );
    await db.query(
      `INSERT INTO milk_production_daily (tenant_id, animal_id, production_date, total_liters, created_by)
       VALUES ($1,$2,CURRENT_DATE,24.5,$3)`,
      [db.tenant, animal!.id, db.user],
    );

    const cond = await weather.currentConditions();
    expect(cond?.system).toBe('dairy');
    const [alerta] = await alertasDeClima();
    expect(alerta.title).toMatch(/moderado/i);
    expect(await db.one<{ message: string }>(
      `SELECT message FROM alerts WHERE tenant_id=$1 AND category='iot' AND status='open' LIMIT 1`,
      [db.tenant],
    )).toMatchObject({ message: expect.stringContaining('lechería') });
  });

  // El motor silencia 14 días lo que cerró una persona. Lo que auto-resolvió porque la condición
  // dejó de darse tiene que poder volver: el calor se termina cada noche y vuelve al día siguiente.
  it('una alerta auto-resuelta vuelve cuando la condición vuelve', async () => {
    await limpiar();
    await medir({ temp_max: 36, humidity: 75 });
    expect((await alertasDeClima()).length).toBeGreaterThan(0);

    await limpiar(); // pasó el calor → el motor la auto-resuelve
    expect(await alertasDeClima()).toEqual([]);

    await medir({ temp_max: 36, humidity: 75 }); // vuelve al día siguiente
    expect((await alertasDeClima()).length).toBeGreaterThan(0);
  });

  // La otra mitad de la regla. Se usa la HELADA para no silenciar el estrés calórico, que los
  // casos siguientes necesitan vivo.
  it('lo que cerró una PERSONA sí queda silenciado', async () => {
    await limpiar();
    await medir({ temp_min: -3, temp_max: 10 });
    await alerts.evaluate();
    const helada = await db.one<{ id: string }>(
      `SELECT a.id FROM alerts a JOIN alert_rules r ON r.id = a.rule_id
       WHERE a.tenant_id=$1 AND r.condition->>'code'='frost' AND a.status='open' LIMIT 1`,
      [db.tenant],
    );
    expect(helada).toBeDefined();
    await alerts.setStatus(helada!.id, 'dismiss');

    // La condición SIGUE dándose, pero el productor ya la despachó: no vuelve a aparecer.
    const despues = await alertasDeClima();
    expect(despues.some((a) => /helada/i.test(a.title))).toBe(false);
  });

  it('la regla se puede apagar desde Configuración', async () => {
    await limpiar();
    await medir({ temp_max: 36, humidity: 75 });
    expect((await alertasDeClima()).length).toBeGreaterThan(0);

    await alerts.updateRule('heat_stress', { is_active: false });
    await alerts.evaluate();
    const abiertas = await db.query(
      `SELECT 1 FROM alerts WHERE tenant_id=$1 AND category='iot' AND status='open' AND deleted_at IS NULL`,
      [db.tenant],
    );
    expect(abiertas).toEqual([]);
  });
});
