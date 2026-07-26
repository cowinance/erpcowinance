import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { addFarmDays, computeCropYields } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
// La regla de QUÉ VENTA CUENTA vive en Comercial y se importa: si acá se repitiera el filtro, el
// día que cambie allá el precio de referencia quedaría calculado sobre otro universo de ventas.
import { SALE_COUNTS } from '../commerce/sales.service';

const STATUSES = ['planned', 'growing', 'harvested', 'failed'];
/** Transiciones permitidas del ciclo de un cultivo. */
const TRANSITIONS: Record<string, string[]> = {
  planned: ['growing', 'failed'],
  growing: ['harvested', 'failed'],
  harvested: [],
  failed: [],
};

/**
 * Agricultura — cultivos (AG-1): `crops` sobre un paddock, con estados planned→growing→harvested/failed.
 * Todo por tenant (RLS); baja lógica por `deleted_at`. Las labores (consumo de insumos) y cosechas
 * (rinde) llegan en AG-2.
 */
@Injectable()
export class CropsService {
  constructor(private readonly db: DbService) {}

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND c.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT c.id, c.paddock_id, p.name AS paddock_name, c.crop_type, c.variety, c.planting_date, c.expected_harvest_date,
              c.area_ha::float AS area_ha, c.status
       FROM crops c JOIN paddocks p ON p.id = c.paddock_id
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL${filter} ORDER BY c.planting_date DESC NULLS LAST, c.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const crop = await this.db.one(
      `SELECT c.id, c.paddock_id, p.name AS paddock_name, c.crop_type, c.variety, c.planting_date, c.expected_harvest_date,
              c.area_ha::float AS area_ha, c.status
       FROM crops c JOIN paddocks p ON p.id = c.paddock_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!crop) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return crop;
  }

  async create(body: any) {
    const cropType = String(body?.crop_type ?? '').trim();
    if (!cropType) throw new BadRequestException({ code: 'agriculture.missing_crop_type', title: 'crop_type es obligatorio' });
    await this.requirePaddock(body?.paddock_id);
    return this.db.one(
      `INSERT INTO crops (tenant_id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8)
       RETURNING id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha::float AS area_ha, status`,
      [this.db.tenant, body.paddock_id, cropType, body?.variety ?? null, body?.planting_date ?? null, body?.expected_harvest_date ?? null, body?.area_ha ?? null, this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.crop_type === 'string') {
      const c = body.crop_type.trim();
      if (!c) throw new BadRequestException({ code: 'agriculture.missing_crop_type', title: 'crop_type no puede ser vacío' });
      set('crop_type', c);
    }
    if (body?.paddock_id !== undefined) {
      await this.requirePaddock(body.paddock_id);
      set('paddock_id', body.paddock_id);
    }
    for (const f of ['variety', 'planting_date', 'expected_harvest_date', 'area_ha'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'agriculture.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE crops SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha::float AS area_ha, status`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return row;
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'agriculture.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const crop = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM crops WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!crop) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    if (crop.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[crop.status]?.includes(next)) throw new ConflictException({ code: 'agriculture.invalid_transition', title: `No se puede pasar de '${crop.status}' a '${next}'` });
    await this.db.query(`UPDATE crops SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  /**
   * Rinde y costo por hectárea de cada lote, comparados contra los del mismo cultivo (Fase 4).
   *
   * El módulo registraba labores y cosechas y no contestaba ninguna de las tres preguntas del cierre
   * de campaña: cuánto rindió, cuánto costó la hectárea, y si este lote anduvo mejor o peor que los
   * otros del mismo cultivo.
   *
   * **El rinde se DERIVA de cosecha ÷ superficie.** `harvests.yield_per_ha` está guardado en la
   * tabla y NO se usa: es un número que se escribió una vez y puede haber quedado distinto de la
   * cantidad y la superficie que tiene al lado. Es el mismo criterio con el que el rendimiento de
   * la res se deriva del peso vivo real y no de la columna.
   *
   * **El precio sale de ventas REALES, no de un supuesto.** Se toma el precio promedio al que se
   * vendió en el período el ítem al que fue a parar la cosecha (`harvests.destination_item_id`). Si
   * ese grano todavía no se vendió, no hay margen: se informa el costo, que es lo que sí se sabe.
   * Un margen calculado sobre un precio inventado se ve igual de convincente que uno real, y es la
   * clase de número sobre el que alguien decide qué sembrar el año que viene.
   */
  async yields(params: { from?: string; to?: string } = {}) {
    const t = this.db.tenant;
    const to = params.to ?? await this.db.today();
    const from = params.from ?? addFarmDays(to, -365);

    const rows = await this.db.query<any>(
      `SELECT c.id, c.crop_type, c.variety, c.status, c.planting_date::text AS planting_date,
              c.area_ha::float AS area_ha, p.name AS paddock_name,
              h.harvested::float AS harvested, h.unit AS yield_unit,
              COALESCE(op.cost, 0)::float AS cost,
              precio.avg_price::float AS avg_price
         FROM crops c
         JOIN paddocks p ON p.id = c.paddock_id
         LEFT JOIN LATERAL (
           SELECT sum(hv.yield_quantity) AS harvested,
                  max(hv.yield_unit) AS unit,
                  max(hv.destination_item_id::text)::uuid AS item_id
             FROM harvests hv
            WHERE hv.crop_id = c.id AND hv.tenant_id = $1 AND hv.deleted_at IS NULL
              AND hv.harvest_date BETWEEN $2::date AND $3::date) h ON true
         LEFT JOIN LATERAL (
           SELECT sum(o.cost) AS cost
             FROM crop_operations o
            WHERE o.crop_id = c.id AND o.tenant_id = $1 AND o.deleted_at IS NULL
              AND o.performed_at::date BETWEEN $2::date AND $3::date) op ON true
         LEFT JOIN LATERAL (
           -- Precio REAL: lo que se cobró por ese grano en el período. Ponderado por cantidad,
           -- porque promediar el precio de una venta de 2 t y una de 200 como si pesaran igual
           -- daría un precio que no se cobró nunca.
           SELECT CASE WHEN sum(sl.quantity) > 0 THEN sum(sl.quantity * sl.unit_price) / sum(sl.quantity) END AS avg_price
             FROM sale_lines sl
             JOIN sales sa ON sa.id = sl.sale_id AND sa.deleted_at IS NULL AND ${SALE_COUNTS}
            WHERE sl.item_id = h.item_id AND sl.tenant_id = $1 AND sl.deleted_at IS NULL
              AND sa.sale_date BETWEEN $2::date AND $3::date) precio ON true
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
          -- Solo los cultivos que TUVIERON ALGO en la ventana: se cosechó, se trabajó, o se sembró
          -- dentro. Un cultivo de otra campaña aparecía con costo cero y sin rinde, indistinguible
          -- de uno recién sembrado, y sumaba una fila que no dice nada del período consultado.
          AND (h.harvested IS NOT NULL OR op.cost IS NOT NULL OR c.planting_date BETWEEN $2::date AND $3::date)
        ORDER BY c.crop_type, p.name`,
      [t, from, to],
    );

    const report = computeCropYields(
      rows.map((r) => ({ cropId: r.id, cropType: r.crop_type, areaHa: r.area_ha, harvested: r.harvested, cost: r.cost, price: r.avg_price })),
    );

    // Los datos de contexto (potrero, variedad, unidad) los pone el servicio: la regla del dominio
    // no los necesita para calcular y meterlos ahí la ataría al esquema.
    const extra = new Map(rows.map((r) => [r.id, r]));
    return {
      from,
      to,
      crops: report.crops.map((c) => {
        const r = extra.get(c.cropId);
        return {
          ...c,
          paddock_name: r?.paddock_name ?? null,
          variety: r?.variety ?? null,
          status: r?.status ?? null,
          planting_date: r?.planting_date ?? null,
          yield_unit: r?.yield_unit ?? null,
          /** Precio con el que se valorizó, para que el margen no sea un número sin origen. */
          price_used: r?.avg_price ?? null,
        };
      }),
      by_type: report.byType,
    };
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE crops SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'agriculture.crop_not_found', title: 'Cultivo no encontrado' });
    return { id, deleted: true };
  }

  private async requirePaddock(id: string | undefined) {
    if (!id) throw new BadRequestException({ code: 'agriculture.missing_paddock', title: 'paddock_id es obligatorio' });
    const p = await this.db.one<{ id: string }>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'agriculture.paddock_not_found', title: 'Potrero no encontrado' });
  }
}
