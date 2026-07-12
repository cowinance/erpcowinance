import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { MovementService } from './movement.service';

@Injectable()
export class LandService {
  constructor(
    private readonly db: DbService,
    private readonly movement: MovementService,
  ) {}

  /** Potreros con geometría, ocupación y lotes presentes (para el mapa). */
  async paddocks() {
    const rows = await this.db.query<any>(
      `SELECT p.id, p.name, p.boundary, p.area_ha::float, p.pasture_type,
              (SELECT count(*)::int FROM animals a
                WHERE a.current_paddock_id = p.id AND a.status = 'active' AND a.deleted_at IS NULL) AS animal_count
       FROM paddocks p
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.is_active
       ORDER BY p.name`,
      [this.db.tenant],
    );
    const lots = await this.db.query<any>(
      `SELECT l.id, l.name, l.purpose, l.current_paddock_id,
              (SELECT count(*)::int FROM animals a
                WHERE a.current_lot_id = l.id AND a.status = 'active' AND a.deleted_at IS NULL) AS animal_count
       FROM lots l WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND l.is_active ORDER BY l.name`,
      [this.db.tenant],
    );
    return rows.map((p) => ({
      ...p,
      stocking_rate: p.area_ha ? +(p.animal_count / p.area_ha).toFixed(2) : null,
      lots: lots.filter((l) => l.current_paddock_id === p.id).map(({ id, name, purpose, animal_count }) => ({ id, name, purpose, animal_count })),
    }));
  }

  /**
   * Mover un lote completo a otro potrero. Actualiza `lots.current_paddock_id` y
   * DELEGA el movimiento de sus animales en el núcleo neutral
   * `MovementService.recordMovement` (M-1) — sin persistir hechos/timeline/versiones
   * inline. Todo en UNA transacción: si el movimiento animal falla, el lote NO queda
   * movido. Idempotencia del endpoint por atomicidad + guard `already_there` + lock
   * de fila del lote (serializa dobles submits). Propaga por server-origin (nuevo).
   * Contrato HTTP y respuesta preservados: `{ moved, lot, from, to }`.
   */
  async moveLot(paddockId: string, body: { lot_id?: string }) {
    if (!body?.lot_id) throw new BadRequestException({ code: 'move.missing_lot', title: 'lot_id es obligatorio' });
    const t = this.db.tenant;

    return this.db.tx(async (q) => {
      const paddock = await q.one<any>(
        `SELECT id, name FROM paddocks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [paddockId, t],
      );
      if (!paddock) throw new NotFoundException({ code: 'paddock.not_found', title: 'Potrero no encontrado' });

      // Lock de fila del lote: serializa movimientos concurrentes del mismo lote
      // (el segundo verá el potrero nuevo → `already_there`, sin duplicar hechos).
      const lot = await q.one<any>(
        `SELECT l.id, l.name, l.current_paddock_id, fp.name AS from_name
         FROM lots l LEFT JOIN paddocks fp ON fp.id = l.current_paddock_id
         WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL
         FOR UPDATE OF l`,
        [body.lot_id, t],
      );
      if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
      if (lot.current_paddock_id === paddockId)
        throw new BadRequestException({ code: 'move.already_there', title: `${lot.name} ya está en ${paddock.name}` });

      const animals = await q.query<{ id: string }>(
        `SELECT id FROM animals WHERE current_lot_id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
        [body.lot_id, t],
      );

      // 1) El lote cambia de potrero (su tabla). Debe ir ANTES de recordMovement para
      //    que P(lote)=nuevo potrero y la intención `{paddock}` resuelva coherente.
      await q.query(`UPDATE lots SET current_paddock_id = $2, updated_at = now() WHERE id = $1`, [body.lot_id, paddockId]);

      // 2) Los animales del lote siguen su lote al nuevo potrero, vía la regla única.
      //    recordMovement lee el potrero ANTERIOR de cada animal (aún sin tocar) como `from`.
      await this.movement.recordMovement(q, {
        animalIds: animals.map((a) => a.id),
        to: { paddock: paddockId },
        reason: 'rotación',
        actorUserId: this.db.user,
        origin: 'map',
        movementId: randomUUID(),
        emitServerOrigin: true,
      });

      return { moved: animals.length, lot: lot.name, from: lot.from_name ?? null, to: paddock.name };
    });
  }
}
