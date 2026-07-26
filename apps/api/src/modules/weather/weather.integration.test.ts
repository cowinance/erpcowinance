import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WeatherService } from './weather.service';

/**
 * Integración de D4 sobre las tablas canónicas (`devices` + `sensor_readings`): alta de estación,
 * ingesta validada, y los índices DERIVADOS de la serie cruda.
 */
describe('clima — estaciones, ingesta e índices (D4)', () => {
  let db: DbService;
  let svc: WeatherService;
  let tmp: string;
  let originalCwd: string;
  let stationId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'weather-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm(); // precalentar: `createStation` la consultaría dentro de la tx (PGlite, conexión única)
    svc = new WeatherService(db);
    // El demo trae su propia estación (Fase 3.2). Esta suite AFIRMA sobre el conjunto de estaciones
    // y de mediciones, así que arranca siendo dueña del fixture en vez de suponer una base vacía:
    // suponerlo la hacía romperse cada vez que el seed se enriquecía, sin que nada estuviera mal.
    await db.query(`DELETE FROM sensor_readings WHERE tenant_id = $1`, [db.tenant]);
    await db.query(`DELETE FROM devices WHERE tenant_id = $1`, [db.tenant]);

    const station: any = await svc.createStation({ name: 'Casco', serial_number: 'EST-001' });
    stationId = station.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const cargar = (fecha: string, metricas: Record<string, number>) =>
    svc.ingest({
      station_id: stationId,
      readings: Object.entries(metricas).map(([metric, value]) => ({
        metric,
        value,
        recorded_at: `${fecha}T12:00:00Z`,
      })),
    });

  it('registra la estación como device environmental, no como cualquier dispositivo', async () => {
    const estaciones: any[] = await svc.stations();
    expect(estaciones).toHaveLength(1);
    expect(estaciones[0]).toMatchObject({ name: 'Casco', serial_number: 'EST-001', status: 'active' });
  });

  it('rechaza un número de serie repetido', async () => {
    await expect(svc.createStation({ serial_number: 'EST-001' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'weather.duplicate_serial' },
    });
  });

  it('ingesta un lote y deja la estación como vista recién', async () => {
    const r = await cargar('2026-02-01', { temp_min: 14, temp_max: 29, humidity: 60, rain: 12, etp: 5 });
    expect(r).toEqual({ ingested: 5 });
    const [estacion]: any[] = await svc.stations();
    expect(estacion.readings).toBe(5);
    expect(estacion.last_seen_at).toBeTruthy();
  });

  // Media tanda cargada es peor que ninguna: los índices se derivan de la serie, así que un lote a
  // medias produce indicadores creíbles y equivocados.
  it('valida TODO el lote antes de escribir nada', async () => {
    const antes: any[] = await svc.stations();
    await expect(
      svc.ingest({
        station_id: stationId,
        readings: [
          { metric: 'rain', value: 10, recorded_at: '2026-02-02T12:00:00Z' },
          { metric: 'humidity', value: 250, recorded_at: '2026-02-02T12:00:00Z' }, // imposible
        ],
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'weather.invalid_value' } });
    const despues: any[] = await svc.stations();
    expect(despues[0].readings).toBe(antes[0].readings); // no entró ni la primera
  });

  it.each([
    ['métrica desconocida', { metric: 'presion', value: 1013, recorded_at: '2026-02-02T12:00:00Z' }, 'weather.unknown_metric'],
    ['lluvia negativa', { metric: 'rain', value: -3, recorded_at: '2026-02-02T12:00:00Z' }, 'weather.invalid_value'],
    ['valor no numérico', { metric: 'temp', value: 'templado', recorded_at: '2026-02-02T12:00:00Z' }, 'weather.invalid_value'],
    ['sin instante', { metric: 'temp', value: 20 }, 'weather.invalid_date'],
  ])('rechaza %s', async (_caso, reading, code) => {
    await expect(svc.ingest({ station_id: stationId, readings: [reading] })).rejects.toMatchObject({
      status: 400,
      response: { code },
    });
  });

  it('rechaza una estación inexistente', async () => {
    await expect(
      svc.ingest({ station_id: '00000000-0000-0000-0000-0000000000ff', readings: [{ metric: 'rain', value: 1, recorded_at: '2026-02-01T00:00:00Z' }] }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'weather.station_not_found' } });
  });

  it('agrega por día según cada métrica: la lluvia SUMA, la temperatura no', async () => {
    await svc.ingest({
      station_id: stationId,
      readings: [
        { metric: 'rain', value: 4, recorded_at: '2026-02-03T06:00:00Z' },
        { metric: 'rain', value: 6, recorded_at: '2026-02-03T18:00:00Z' },
        { metric: 'temp_max', value: 22, recorded_at: '2026-02-03T06:00:00Z' },
        { metric: 'temp_max', value: 31, recorded_at: '2026-02-03T18:00:00Z' },
      ],
    });
    const dias = await svc.daily({ from: '2026-02-03', to: '2026-02-03' });
    expect(dias).toHaveLength(1);
    expect(dias[0].rainMm).toBe(10); // sumadas
    expect(dias[0].tempMaxC).toBe(31); // la mayor, no la suma ni el promedio
  });

  // 36 °C con 75 % da THI 91.5: emergencia en la escala de carne (≥ 89). El THI no es la
  // temperatura: 36 °C con aire seco no llegaría a ese nivel.
  it('deriva THI y nivel de estrés de la serie', async () => {
    await cargar('2026-02-04', { temp_max: 36, humidity: 75 });
    const [dia] = await svc.daily({ from: '2026-02-04', to: '2026-02-04' });
    expect(dia.thi).toBe(91.5);
    expect(dia.heat_stress).toBe('emergency');
  });

  // La misma serie, distinto sistema productivo: el tambo tiene que ver el estrés antes.
  it('el sistema productivo cambia el nivel sobre los MISMOS datos', async () => {
    await cargar('2026-02-05', { temp_max: 24, humidity: 65 });
    const [lecheria] = await svc.daily({ from: '2026-02-05', to: '2026-02-05', system: 'dairy' });
    const [carne] = await svc.daily({ from: '2026-02-05', to: '2026-02-05', system: 'beef' });
    expect(lecheria.thi).toBe(carne.thi);
    expect(lecheria.heat_stress).toBe('mild');
    expect(carne.heat_stress).toBe('none');
  });

  it('el resumen acumula los indicadores del período e informa la cobertura', async () => {
    const r = await svc.summary({ from: '2026-02-01', to: '2026-02-10', gddBase: 10 });
    expect(r.rainMm).toBe(22); // 12 del día 1 + 10 del día 3
    expect(r.waterBalanceMm).toBe(7); // solo el día 1 tiene ETP: 12 − 5
    expect(r.gdd).toBeGreaterThan(0);
    expect(r.maxHeatStress).toBe('emergency'); // el pico del período es el día 4
    expect(r.daysWithoutData).toBe(6); // 10 días de rango, 4 con mediciones
  });

  it('el rango por defecto son los últimos 30 días y no rompe sin datos', async () => {
    const r = await svc.summary();
    expect(r.days).toBe(0);
    expect(r.rainMm).toBeNull();
  });

  it('rechaza un rango invertido', async () => {
    await expect(svc.summary({ from: '2026-03-01', to: '2026-02-01' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'weather.invalid_range' },
    });
  });

  it('filtra por estación', async () => {
    const otra: any = await svc.createStation({ name: 'Potrero 7', serial_number: 'EST-002' });
    await svc.ingest({
      station_id: otra.id,
      readings: [{ metric: 'rain', value: 40, recorded_at: '2026-02-01T12:00:00Z' }],
    });
    const soloOtra = await svc.summary({ from: '2026-02-01', to: '2026-02-10', stationId: otra.id });
    const todas = await svc.summary({ from: '2026-02-01', to: '2026-02-10' });
    expect(soloOtra.rainMm).toBe(40);
    expect(todas.rainMm).toBe(62);
  });
});
