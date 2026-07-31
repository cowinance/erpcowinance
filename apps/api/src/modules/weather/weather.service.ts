import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addFarmDays,
  type DailyWeather,
  type ProductionSystem,
  dailyThi,
  heatStressLevel,
  isFrost,
  summarizeWeather,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Clima y agrometeorología (D4).
 *
 * MODELO: una estación es un `device` de tipo `environmental` y cada medición una fila de
 * `sensor_readings` — las entidades que el catálogo asigna al módulo. Se activan **solo** esas dos
 * tablas: la gestión de flota de dispositivos (aprovisionamiento, gateways, certificados) es K1
 * (IoT, Fase 3) y no se construye acá. Una estación, para D4, es una fuente de datos con nombre.
 *
 * Las mediciones se guardan como serie de tiempo cruda (métrica, valor, instante) y los índices se
 * DERIVAN al consultarlos, igual que la GDP en P8: si mañana se corrige una lectura, todos los
 * indicadores se corrigen solos. Nada se materializa.
 */

/**
 * Métricas que el módulo entiende, con su unidad. Lo que llegue fuera de esta lista se rechaza.
 *
 * **La unidad vive acá y NO en `sensor_readings.unit`**, que queda en NULL. Esa columna tiene una
 * FK contra el catálogo canónico `units`, y ese catálogo no puede expresar ni humedad relativa (%)
 * ni velocidad de viento (km/h): sus dimensiones son masa, volumen, área, longitud, temperatura,
 * tiempo, conteo y energía. Llenar la columna solo para las métricas que sí encajan dejaría un dato
 * a medias, que es peor que uno ausente. La métrica determina la unidad sin ambigüedad —`rain`
 * siempre es mm— así que la fuente única es este mapa.
 */
export const METRICS = {
  temp: 'C',
  temp_min: 'C',
  temp_max: 'C',
  humidity: '%',
  rain: 'mm',
  wind: 'km/h',
  etp: 'mm',
} as const;
export type Metric = keyof typeof METRICS;

const METRIC_LIST = Object.keys(METRICS) as Metric[];

/** Cómo se agrega cada métrica a nivel día: la lluvia se SUMA, la temperatura no. */
const DAILY_AGGREGATE: Record<Metric, 'sum' | 'avg' | 'min' | 'max'> = {
  temp: 'avg',
  temp_min: 'min',
  temp_max: 'max',
  humidity: 'avg',
  rain: 'sum',
  wind: 'max',
  etp: 'sum',
};

export interface RangeParams {
  from?: string;
  to?: string;
  stationId?: string;
  system?: ProductionSystem;
  gddBase?: number;
  gddCap?: number;
  frostThresholdC?: number;
}

@Injectable()
export class WeatherService {
  constructor(private readonly db: DbService) {}

  // ── Estaciones ────────────────────────────────────────────────────────────

  async stations() {
    return this.db.query(
      `SELECT d.id, d.name, d.serial_number, d.status, d.last_seen_at, d.battery_level, f.name AS farm_name,
              (SELECT count(*)::int FROM sensor_readings r WHERE r.device_id = d.id AND r.tenant_id = d.tenant_id) AS readings
       FROM devices d
       JOIN device_types t ON t.id = d.device_type_id AND t.category = 'environmental'
       LEFT JOIN farms f ON f.id = d.farm_id
       WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
       ORDER BY d.name NULLS LAST, d.serial_number`,
      [this.db.tenant],
    );
  }

  async createStation(body: { name?: string; serial_number?: string; farm_id?: string }) {
    const serial = String(body?.serial_number ?? '').trim();
    if (!serial)
      throw new BadRequestException({ code: 'weather.missing_serial', title: 'El número de serie es obligatorio' });

    const typeId = await this.stationTypeId();
    const farmId = body.farm_id ?? (await this.db.defaultFarm());
    const existing = await this.db.one<{ id: string }>(
      `SELECT id FROM devices WHERE tenant_id = $1 AND serial_number = $2 AND deleted_at IS NULL`,
      [this.db.tenant, serial],
    );
    if (existing)
      throw new BadRequestException({
        code: 'weather.duplicate_serial',
        title: `Ya existe una estación con el número de serie ${serial}`,
      });

    return this.db.one(
      `INSERT INTO devices (tenant_id, farm_id, device_type_id, serial_number, name, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'active',$6) RETURNING id, name, serial_number, status`,
      [this.db.tenant, farmId, typeId, serial, body.name?.trim() || serial, this.db.user],
    );
  }

  /**
   * El tipo de dispositivo es un catálogo GLOBAL (sin tenant): se crea una vez y lo comparten
   * todos. Idempotente, para no obligar a un paso de seed que después habría que recordar.
   */
  private async stationTypeId(): Promise<string> {
    const found = await this.db.one<{ id: string }>(`SELECT id FROM device_types WHERE code = 'weather_station'`);
    if (found) return found.id;
    const created = await this.db.one<{ id: string }>(
      `INSERT INTO device_types (code, name, category) VALUES ('weather_station','Estación meteorológica','environmental')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    return created!.id;
  }

  // ── Ingesta ───────────────────────────────────────────────────────────────

  /**
   * Carga mediciones. Acepta un lote porque las estaciones vuelcan por tandas y la carga manual
   * suele ser "el parte del día": una request, N métricas.
   *
   * Se valida TODO antes de escribir nada. Media tanda cargada es peor que ninguna: los índices se
   * derivan de la serie, así que un lote a medias produce indicadores creíbles y equivocados.
   */
  async ingest(body: { station_id?: string; readings?: unknown[] }) {
    const stationId = String(body?.station_id ?? '').trim();
    const station = await this.db.one<{ id: string }>(
      `SELECT d.id FROM devices d JOIN device_types t ON t.id = d.device_type_id AND t.category = 'environmental'
       WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`,
      [stationId || '00000000-0000-0000-0000-000000000000', this.db.tenant],
    );
    if (!station) throw new NotFoundException({ code: 'weather.station_not_found', title: 'Estación no encontrada' });

    const raw = Array.isArray(body?.readings) ? body.readings : [];
    if (raw.length === 0)
      throw new BadRequestException({ code: 'weather.no_readings', title: 'No se enviaron mediciones' });

    const readings = raw.map((r, i) => this.validateReading(r, i));

    await this.db.tx(async (q) => {
      for (const r of readings) {
        await q.query(
          `INSERT INTO sensor_readings (tenant_id, device_id, metric, value, recorded_at)
           VALUES ($1,$2,$3,$4,$5::timestamptz)`,
          [this.db.tenant, station.id, r.metric, r.value, r.recorded_at],
        );
      }
      await q.query(`UPDATE devices SET last_seen_at = now(), updated_at = now() WHERE id = $1`, [station.id]);
    });

    return { ingested: readings.length };
  }

  private validateReading(r: unknown, index: number): { metric: Metric; value: number; recorded_at: string } {
    const row = (r ?? {}) as { metric?: unknown; value?: unknown; recorded_at?: unknown };
    const metric = String(row.metric ?? '').trim() as Metric;
    if (!METRIC_LIST.includes(metric))
      throw new BadRequestException({
        code: 'weather.unknown_metric',
        title: `Medición ${index + 1}: métrica desconocida "${row.metric}". Válidas: ${METRIC_LIST.join(', ')}`,
      });

    const value = Number(row.value);
    if (!Number.isFinite(value))
      throw new BadRequestException({
        code: 'weather.invalid_value',
        title: `Medición ${index + 1}: el valor "${row.value}" no es un número`,
      });
    // La lluvia negativa o la humedad de 300 % son errores de sensor, no datos. Entran al
    // acumulado y lo arruinan sin dejar rastro.
    if (metric === 'rain' && value < 0)
      throw new BadRequestException({ code: 'weather.invalid_value', title: `Medición ${index + 1}: la lluvia no puede ser negativa` });
    if (metric === 'humidity' && (value < 0 || value > 100))
      throw new BadRequestException({ code: 'weather.invalid_value', title: `Medición ${index + 1}: la humedad debe estar entre 0 y 100 %` });

    const at = new Date(String(row.recorded_at ?? ''));
    if (Number.isNaN(at.getTime()))
      throw new BadRequestException({
        code: 'weather.invalid_date',
        title: `Medición ${index + 1}: falta el instante de la medición (recorded_at)`,
      });

    return { metric, value, recorded_at: at.toISOString() };
  }

  // ── Series e índices ──────────────────────────────────────────────────────

  /** Serie diaria: una fila por día con cada métrica agregada según corresponda. */
  async daily(params: RangeParams = {}): Promise<(DailyWeather & { thi: number | null; heat_stress: string | null })[]> {
    const { from, to } = await this.range(params);
    const agregados = METRIC_LIST.map(
      (m) => `${sqlAggregate(DAILY_AGGREGATE[m])}(value) FILTER (WHERE metric = '${m}') AS ${m}`,
    ).join(',\n              ');

    const rows = await this.db.query<Record<string, string | null>>(
      // El día es el de la FINCA, no el de Greenwich.
      //
      // Acá decía `AT TIME ZONE 'UTC'`, que PISA la zona de la sesión. Y la sesión ya trae la de la
      // finca: `applyTenantContext` la fija en cada transacción justamente para que las fechas no
      // corran en la del servidor. Al forzar UTC, una medición de las 21:00 en el campo —que en
      // Venezuela es la 01:00 UTC del día siguiente— caía en el balde de mañana.
      //
      // No es cosmético: los bordes del rango vienen de `db.today()`, que SÍ es día de finca, así
      // que se filtraba con un calendario y se agrupaba con otro. Cada día del año, las últimas
      // horas de luz se contaban en el día equivocado, y el «hoy» del motor de alertas arrancaba
      // con la noche de ayer adentro. Sacar el `AT TIME ZONE` alcanza: el `::date` de un
      // `timestamptz` usa la zona de la sesión, que es la que corresponde.
      `SELECT r.recorded_at::date::text AS date,
              ${agregados}
       FROM sensor_readings r
       JOIN devices d ON d.id = r.device_id AND d.tenant_id = r.tenant_id AND d.deleted_at IS NULL
       JOIN device_types t ON t.id = d.device_type_id AND t.category = 'environmental'
       WHERE r.tenant_id = $1
         AND r.recorded_at::date BETWEEN $2::date AND $3::date
         AND ($4::uuid IS NULL OR r.device_id = $4::uuid)
       GROUP BY 1 ORDER BY 1`,
      [this.db.tenant, from, to, params.stationId ?? null],
    );

    const system = params.system ?? 'beef';
    return rows.map((r) => {
      const day = toDailyWeather(r);
      const thi = dailyThi(day);
      return { ...day, thi, heat_stress: thi == null ? null : heatStressLevel(thi, system) };
    });
  }

  /** Indicadores del período (los cuatro que pide el catálogo) + la serie que los sustenta. */
  async summary(params: RangeParams = {}) {
    const { from, to } = await this.range(params);
    const days = await this.daily({ ...params, from, to });
    const summary = summarizeWeather(days, from, to, {
      system: params.system,
      frostThresholdC: params.frostThresholdC,
      gdd: params.gddBase != null ? { baseC: params.gddBase, capC: params.gddCap } : undefined,
      expectedDays: daysBetween(from, to),
    });
    return { ...summary, system: params.system ?? 'beef', days_series: days };
  }

  /**
   * Sistema productivo del tenant, DERIVADO de lo que la finca hace: si hay producción de leche
   * registrada, se usa la escala de lechería; si no, la de carne.
   *
   * Se deriva en vez de configurarse porque no hay dónde guardarlo sin agregar una columna, y
   * porque el dato ya existe: una finca que ordeña tiene tambo cargado. Para que no sea magia
   * escondida, la escala elegida VIAJA en la respuesta (`system`) y en el texto de la alerta.
   */
  async productionSystem(): Promise<ProductionSystem> {
    const hayTambo = await this.db.one<{ n: number }>(
      `SELECT 1 AS n FROM milk_production_daily WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [this.db.tenant],
    );
    return hayTambo ? 'dairy' : 'beef';
  }

  /**
   * Condiciones de HOY que ameritan avisar. La usa el motor de alertas (A5): esta es la fuente
   * única del criterio, no una copia de los umbrales dentro de `AlertsService`.
   */
  async currentConditions(): Promise<{
    date: string;
    system: ProductionSystem;
    thi: number | null;
    heatStress: string | null;
    tempMinC: number | null;
    frost: boolean;
    rainMm: number | null;
  } | null> {
    const system = await this.productionSystem();
    // Se mira una ventana de 2 días y se toma el último con datos: una estación que vuelca a la
    // madrugada dejaría "hoy" vacío hasta el mediodía, y una alerta de calor que aparece a las
    // 14 h llega tarde.
    const hoy = await this.db.today();
    const ayer = addFarmDays(await this.db.today(), -1);
    const dias = await this.daily({ from: ayer, to: hoy, system });
    const ultimo = dias.at(-1);
    if (!ultimo) return null;
    return {
      date: ultimo.date,
      system,
      thi: ultimo.thi,
      heatStress: ultimo.heat_stress,
      tempMinC: ultimo.tempMinC ?? null,
      frost: isFrost(ultimo),
      rainMm: ultimo.rainMm ?? null,
    };
  }

  /** Rango por defecto: los últimos 30 días. */
  private async range(params: RangeParams): Promise<{ from: string; to: string }> {
    const to = params.to ?? (await this.db.today());
    const from = params.from ?? addFarmDays(to, -29);
    if (from > to)
      throw new BadRequestException({ code: 'weather.invalid_range', title: 'La fecha inicial es posterior a la final' });
    return { from, to };
  }
}

function sqlAggregate(kind: 'sum' | 'avg' | 'min' | 'max'): string {
  return { sum: 'sum', avg: 'avg', min: 'min', max: 'max' }[kind];
}

/** Postgres devuelve `numeric` como string; se convierte una sola vez, acá. */
function toDailyWeather(r: Record<string, string | null>): DailyWeather {
  const n = (v: string | null | undefined) => (v == null ? null : Math.round(Number(v) * 10) / 10);
  return {
    date: String(r.date),
    tempMeanC: n(r.temp),
    tempMinC: n(r.temp_min),
    tempMaxC: n(r.temp_max),
    humidityPct: n(r.humidity),
    rainMm: n(r.rain),
    windKmh: n(r.wind),
    etpMm: n(r.etp),
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
}
