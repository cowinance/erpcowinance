import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { computeMachineCost, groupMachinesByMeter } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

const TYPES = ['tractor', 'harvester', 'truck', 'atv', 'mixer', 'implement', 'other'];
const STATUSES = ['active', 'maintenance', 'retired'];
/** Transiciones permitidas del estado de una máquina. */
const TRANSITIONS: Record<string, string[]> = {
  active: ['maintenance', 'retired'],
  maintenance: ['active', 'retired'],
  retired: [],
};

/**
 * Maquinaria — maestro (MQ-1): `machinery` por tenant/finca, con estados active/maintenance/retired.
 * Baja lógica por `deleted_at`. Sobre este maestro cuelgan mantenimiento, combustible y horas (MQ-2),
 * y lo referencia `crop_operations.machinery_id` (Agricultura).
 */
@Injectable()
export class MachineryService {
  constructor(private readonly db: DbService) {}

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND status = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status
       FROM machinery WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY (status='active') DESC, name`,
      params,
    );
  }

  async get(id: string) {
    const m = await this.db.one(
      `SELECT id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, device_id, status
       FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!m) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return m;
  }

  async create(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'machinery.missing_name', title: 'name es obligatorio' });
    if (body?.type != null && !TYPES.includes(body.type)) throw new BadRequestException({ code: 'machinery.invalid_type', title: `type inválido (${TYPES.join('|')})` });
    const farm = body?.farm_id ?? (await this.db.defaultFarm());
    if (!farm) throw new BadRequestException({ code: 'machinery.no_farm', title: 'No hay finca para la máquina' });
    return this.db.one(
      `INSERT INTO machinery (tenant_id, farm_id, name, type, make, model, year, plate, engine_hours, odometer_km, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
       RETURNING id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status`,
      [this.db.tenant, farm, name, body?.type ?? null, body?.make ?? null, body?.model ?? null, body?.year ?? null, body?.plate ?? null, body?.engine_hours ?? null, body?.odometer_km ?? null, this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.name === 'string') {
      const n = body.name.trim();
      if (!n) throw new BadRequestException({ code: 'machinery.missing_name', title: 'name no puede ser vacío' });
      set('name', n);
    }
    if (body?.type !== undefined) {
      if (body.type != null && !TYPES.includes(body.type)) throw new BadRequestException({ code: 'machinery.invalid_type', title: 'type inválido' });
      set('type', body.type ?? null);
    }
    for (const f of ['make', 'model', 'year', 'plate', 'engine_hours', 'odometer_km'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'machinery.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE machinery SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, name, type, make, model, year, plate, engine_hours::float AS engine_hours, odometer_km::float AS odometer_km, status`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return row;
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'machinery.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const m = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM machinery WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!m) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    if (m.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[m.status]?.includes(next)) throw new ConflictException({ code: 'machinery.invalid_transition', title: `No se puede pasar de '${m.status}' a '${next}'` });
    await this.db.query(`UPDATE machinery SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  /**
   * Lo que cuesta usar cada máquina (Fase 4).
   *
   * El módulo registraba combustible, mantenimiento y horómetro sin cruzar nada: se sabía cuánto se
   * gastó y no cuánto cuesta USARLA. Es la diferencia entre un archivo de comprobantes y el número
   * que decide si conviene arreglarla, reemplazarla o alquilar.
   *
   * El uso se DERIVA del medidor: la última lectura del período menos la primera, tomando las que
   * quedaron anotadas en las cargas de combustible y en los services. No se usa
   * `machinery.engine_hours` —que es el valor de HOY, no el del final del período— porque mezclaría
   * horas trabajadas fuera del rango y el costo por hora saldría más barato de lo que es.
   *
   * El costo de combustible sale de `total_cost` del propio registro: ya viene valorizado al costo
   * real del inventario cuando la carga descontó stock (MQ-3). Recalcularlo acá sería una segunda
   * verdad sobre el mismo litro.
   */
  async costs(params: { from?: string; to?: string } = {}) {
    const to = params.to ?? new Date().toISOString().slice(0, 10);
    const from = params.from ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const t = this.db.tenant;

    const rows = await this.db.query<any>(
      `SELECT m.id, m.name, m.type, m.status,
              COALESCE(f.liters, 0)::float AS liters,
              COALESCE(f.cost, 0)::float AS fuel_cost,
              COALESCE(mt.preventive, 0)::float AS preventive_cost,
              COALESCE(mt.corrective, 0)::float AS corrective_cost,
              COALESCE(f.hours, '{}') || COALESCE(mt.hours, '{}') AS hour_readings,
              COALESCE(f.kms, '{}') AS km_readings
         FROM machinery m
         LEFT JOIN LATERAL (
           SELECT sum(fl.liters)::numeric AS liters,
                  sum(fl.total_cost)::numeric AS cost,
                  array_remove(array_agg(fl.engine_hours::float), NULL) AS hours,
                  array_remove(array_agg(fl.odometer_km::float), NULL) AS kms
             FROM fuel_logs fl
            WHERE fl.machinery_id = m.id AND fl.tenant_id = $1 AND fl.deleted_at IS NULL
              AND fl.fueled_at::date BETWEEN $2::date AND $3::date) f ON true
         LEFT JOIN LATERAL (
           SELECT sum(mr.cost) FILTER (WHERE mr.type <> 'corrective')::numeric AS preventive,
                  sum(mr.cost) FILTER (WHERE mr.type = 'corrective')::numeric AS corrective,
                  array_remove(array_agg(mr.engine_hours::float), NULL) AS hours
             FROM maintenance_records mr
            WHERE mr.machinery_id = m.id AND mr.tenant_id = $1 AND mr.deleted_at IS NULL
              AND mr.performed_at::date BETWEEN $2::date AND $3::date) mt ON true
        WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.name`,
      [t, from, to],
    );

    const machines = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: r.status,
      cost: computeMachineCost({
        hourReadings: r.hour_readings ?? [],
        kmReadings: r.km_readings ?? [],
        fuelCost: r.fuel_cost,
        fuelLiters: r.liters,
        preventiveCost: r.preventive_cost,
        correctiveCost: r.corrective_cost,
      }),
    }));

    const grupos = groupMachinesByMeter(machines);
    return {
      from,
      to,
      // Separadas por unidad: un ranking que mezcle horas con kilómetros tiene apariencia de orden
      // y ningún sentido.
      by_hours: grupos.hours,
      by_km: grupos.km,
      /** Con gasto cargado pero sin dos lecturas del medidor: no son las más baratas, son las que nadie anotó. */
      unmeasured: grupos.unmeasured,
      totals: {
        fuel_cost: +machines.reduce((s, m) => s + m.cost.fuelCost, 0).toFixed(2),
        maintenance_cost: +machines.reduce((s, m) => s + m.cost.maintenanceCost, 0).toFixed(2),
        total_cost: +machines.reduce((s, m) => s + m.cost.totalCost, 0).toFixed(2),
      },
    };
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE machinery SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'machinery.not_found', title: 'Máquina no encontrada' });
    return { id, deleted: true };
  }
}
