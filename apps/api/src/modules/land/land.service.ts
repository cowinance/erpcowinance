import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent } from '../../common/events';

@Injectable()
export class LandService {
  constructor(private readonly db: DbService) {}

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
   * Mover un lote completo a otro potrero: actualiza lote y animales,
   * y registra el movimiento como hechos (animal_movements + timeline).
   */
  async moveLot(paddockId: string, body: { lot_id?: string }) {
    if (!body?.lot_id) throw new BadRequestException({ code: 'move.missing_lot', title: 'lot_id es obligatorio' });
    const t = this.db.tenant;

    const paddock = await this.db.one<any>(
      `SELECT id, name FROM paddocks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [paddockId, t],
    );
    if (!paddock) throw new NotFoundException({ code: 'paddock.not_found', title: 'Potrero no encontrado' });

    const lot = await this.db.one<any>(
      `SELECT l.id, l.name, l.current_paddock_id, fp.name AS from_name
       FROM lots l LEFT JOIN paddocks fp ON fp.id = l.current_paddock_id
       WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL`,
      [body.lot_id, t],
    );
    if (!lot) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
    if (lot.current_paddock_id === paddockId)
      throw new BadRequestException({ code: 'move.already_there', title: `${lot.name} ya está en ${paddock.name}` });

    const animals = await this.db.query<any>(
      `SELECT id FROM animals WHERE current_lot_id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
      [body.lot_id, t],
    );

    await this.db.query(`UPDATE lots SET current_paddock_id = $2, updated_at = now() WHERE id = $1`, [body.lot_id, paddockId]);
    await this.db.query(
      `UPDATE animals SET current_paddock_id = $2, updated_at = now()
       WHERE current_lot_id = $1 AND tenant_id = $3 AND status = 'active' AND deleted_at IS NULL`,
      [body.lot_id, paddockId, t],
    );

    const movedAt = new Date().toISOString();
    for (const a of animals) {
      await this.db.query(
        `INSERT INTO animal_movements (tenant_id, animal_id, moved_at, from_paddock_id, to_paddock_id, from_lot_id, to_lot_id, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6,'rotación',$7)`,
        [t, a.id, movedAt, lot.current_paddock_id, paddockId, body.lot_id, this.db.user],
      );
      await insertAnimalEvent(this.db, a.id, 'movement', { from: lot.from_name ?? null, to: paddock.name, lot: lot.name }, movedAt);
    }

    return { moved: animals.length, lot: lot.name, from: lot.from_name ?? null, to: paddock.name };
  }
}
