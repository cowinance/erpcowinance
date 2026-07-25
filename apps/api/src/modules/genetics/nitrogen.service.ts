import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_REFILL_LEAD_DAYS,
  InvalidNitrogenError,
  computeNitrogenState,
  nitrogenAlertMessage,
  validateReading,
  validateRefill,
  type NitrogenState,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Nitrógeno del termo (GT-4).
 *
 * Es la etapa que más plata protege del vertical: un termo sin nitrógeno destruye todo lo que tiene
 * adentro, en silencio. Lo que se guarda son hechos —mediciones fechadas y recargas—; el consumo,
 * los días restantes y la fecha de vacío son DERIVADOS, por la misma razón que el saldo de pajuelas:
 * un número guardado y unos hechos son dos fuentes que un día no coinciden.
 */
@Injectable()
export class NitrogenService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
  ) {}

  private dominio<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidNitrogenError)
        throw new BadRequestException({ code: 'genetics.invalid_nitrogen', title: e.message });
      throw e;
    }
  }

  private async requireTank(id: string) {
    const t = await this.db.one<any>(
      `SELECT id, code, refill_lead_days FROM storage_tanks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!t) throw new NotFoundException({ code: 'genetics.tank_not_found', title: 'Termo no encontrado' });
    return t;
  }

  /** Estado de UN termo, con su historial: es la pantalla que se mira antes de pedir la recarga. */
  async status(tankId: string) {
    const tank = await this.requireTank(tankId);
    const [readings, refills] = await Promise.all([
      this.db.query<any>(
        `SELECT id, reading_date::text AS reading_date, level_cm::float AS level_cm, notes
         FROM cryo_nitrogen_readings WHERE tank_id=$1 AND tenant_id=$2 AND deleted_at IS NULL
         ORDER BY reading_date DESC LIMIT 60`,
        [tankId, this.db.tenant],
      ),
      this.db.query<any>(
        `SELECT id, refill_date::text AS refill_date, liters::float AS liters, level_after_cm::float AS level_after_cm, notes
         FROM cryo_nitrogen_refills WHERE tank_id=$1 AND tenant_id=$2 AND deleted_at IS NULL
         ORDER BY refill_date DESC LIMIT 30`,
        [tankId, this.db.tenant],
      ),
    ]);

    const leadDays = tank.refill_lead_days ?? DEFAULT_REFILL_LEAD_DAYS;
    const state = computeNitrogenState(readings, refills[0]?.refill_date ?? null, leadDays);
    return {
      tank_id: tankId,
      tank_code: tank.code,
      lead_days: leadDays,
      state,
      // Sin mensaje cuando no se sabe: `reason` ya explica QUÉ falta, y agregar «sin datos
      // suficientes» al lado sería decir dos veces lo mismo con menos información.
      message: state.status === 'ok' || state.status === 'unknown' ? null : nitrogenAlertMessage(state, tank.code ?? '—', leadDays),
      readings,
      refills,
    };
  }

  /**
   * El estado de TODOS los termos, en dos consultas.
   *
   * Lo usa el motor de alertas, que corre en cada evaluación: un `n+1` por termo lo haría pagar el
   * costo del historial completo por cada finca en cada vuelta.
   */
  async statusAll(): Promise<
    { tank_id: string; tank_code: string | null; lead_days: number; state: NitrogenState; message: string | null }[]
  > {
    const [tanks, readings, refills] = await Promise.all([
      this.db.query<any>(
        `SELECT id, code, refill_lead_days FROM storage_tanks WHERE tenant_id=$1 AND deleted_at IS NULL`,
        [this.db.tenant],
      ),
      this.db.query<any>(
        `SELECT tank_id, reading_date::text AS reading_date, level_cm::float AS level_cm
         FROM cryo_nitrogen_readings WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY reading_date`,
        [this.db.tenant],
      ),
      this.db.query<any>(
        `SELECT DISTINCT ON (tank_id) tank_id, refill_date::text AS refill_date
         FROM cryo_nitrogen_refills WHERE tenant_id=$1 AND deleted_at IS NULL
         ORDER BY tank_id, refill_date DESC`,
        [this.db.tenant],
      ),
    ]);

    const porTermo = new Map<string, any[]>();
    for (const r of readings) porTermo.set(r.tank_id, [...(porTermo.get(r.tank_id) ?? []), r]);
    const ultimaRecarga = new Map(refills.map((r) => [r.tank_id, r.refill_date]));

    return tanks.map((t) => {
      const leadDays = t.refill_lead_days ?? DEFAULT_REFILL_LEAD_DAYS;
      const state = computeNitrogenState(porTermo.get(t.id) ?? [], ultimaRecarga.get(t.id) ?? null, leadDays);
      return {
        tank_id: t.id,
        tank_code: t.code,
        lead_days: leadDays,
        state,
        message: state.status === 'ok' || state.status === 'unknown' ? null : nitrogenAlertMessage(state, t.code ?? '—', leadDays),
      };
    });
  }

  /**
   * Medición de nivel. Repetir el mismo día CORRIGE la anterior en vez de sumar una fila: dos
   * mediciones del mismo día meterían una caída de cero días en el cálculo del consumo.
   */
  async addReading(tankId: string, body: any) {
    await this.requireTank(tankId);
    const input = this.dominio(() => validateReading(body));
    const r = await this.db.query<any>(
      `INSERT INTO cryo_nitrogen_readings (tenant_id, tank_id, reading_date, level_cm, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tank_id, reading_date) WHERE deleted_at IS NULL
       DO UPDATE SET level_cm = EXCLUDED.level_cm, notes = EXCLUDED.notes, updated_at = now()
       RETURNING id, reading_date::text AS reading_date, level_cm::float AS level_cm`,
      [this.db.tenant, tankId, input.reading_date, input.level_cm, body?.notes ?? null, this.db.user],
    );
    return r[0];
  }

  /**
   * Recarga. Si se indica el item de inventario, DESCUENTA el stock en la misma transacción.
   *
   * El nitrógeno líquido es un insumo como cualquier otro y su saldo vive en el kardex —mismo
   * criterio que nos llevó a NO poner las pajuelas ahí: cada cosa con su dueño, una sola fuente por
   * número—. Si falla el descuento no queda la recarga registrada: un termo que el sistema cree
   * recargado sin que el stock lo refleje es la clase de desajuste que aparece meses después.
   *
   * La recarga puede traer el nivel al que quedó el termo: eso arranca el ciclo nuevo sin esperar a
   * la próxima visita, que es lo que permite volver a proyectar enseguida.
   */
  async addRefill(tankId: string, body: any) {
    await this.requireTank(tankId);
    const input = this.dominio(() => validateRefill(body));

    return this.db.tx(async (q) => {
      let movementId: string | null = null;
      if (body?.item_id && body?.warehouse_id) {
        // `recordMovementInTx` devuelve `{ movement, level }`, no la fila suelta.
        const { movement }: any = await this.inventory.recordMovementInTx(q, {
          item_id: body.item_id,
          warehouse_id: body.warehouse_id,
          movement_type: 'consumption',
          quantity: -input.liters,
          occurred_at: input.refill_date,
          reference_type: 'nitrogen_refill',
        });
        movementId = movement?.id ?? null;
      }

      const r = await q.query<any>(
        `INSERT INTO cryo_nitrogen_refills (tenant_id, tank_id, refill_date, liters, level_after_cm, item_id, warehouse_id, stock_movement_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, refill_date::text AS refill_date, liters::float AS liters, level_after_cm::float AS level_after_cm`,
        [this.db.tenant, tankId, input.refill_date, input.liters, input.level_after_cm, body?.item_id ?? null, body?.warehouse_id ?? null, movementId, body?.notes ?? null, this.db.user],
      );

      // El nivel post-recarga es también una medición: se guarda como tal para que el ciclo nuevo
      // tenga su punto de partida sin depender de que alguien vuelva a medir.
      if (input.level_after_cm !== null)
        await q.query(
          `INSERT INTO cryo_nitrogen_readings (tenant_id, tank_id, reading_date, level_cm, notes, created_by)
           VALUES ($1,$2,$3,$4,'Nivel tras la recarga',$5)
           ON CONFLICT (tank_id, reading_date) WHERE deleted_at IS NULL
           DO UPDATE SET level_cm = EXCLUDED.level_cm, updated_at = now()`,
          [this.db.tenant, tankId, input.refill_date, input.level_after_cm, this.db.user],
        );

      return { ...r[0], stock_movement_id: movementId };
    });
  }

  /** Plazo de reposición del proveedor: lo que decide si una alerta es aviso o urgencia. */
  async setLeadDays(tankId: string, days: unknown) {
    await this.requireTank(tankId);
    const n = days == null || days === '' ? null : Number(days);
    if (n !== null && (!Number.isInteger(n) || n <= 0))
      throw new BadRequestException({ code: 'genetics.invalid_lead_days', title: 'Los días de reposición deben ser un entero mayor que cero' });
    const r = await this.db.query<any>(
      `UPDATE storage_tanks SET refill_lead_days=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2
       RETURNING id, code, refill_lead_days`,
      [tankId, this.db.tenant, n],
    );
    return r[0];
  }
}
