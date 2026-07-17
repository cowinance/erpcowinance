import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InvalidPolygonError, polygonAreaHa, toPolygonGeoJSON } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { MovementService, type MovementIntent } from './movement.service';

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

  /** Alta mínima de un potrero (name + finca por defecto; area/pastura opcionales). */
  /**
   * Normaliza la geometría dibujada: valida el polígono y DERIVA la superficie (medición, regla única
   * `polygonAreaHa`). Devuelve el GeoJSON a persistir en `boundary` y el área en ha. Sin geometría,
   * conserva el `area_ha` provisto (potrero sin mapear todavía).
   */
  private geometry(body: any): { boundary: string | null; areaHa: number | null } {
    if (body?.boundary == null) return { boundary: null, areaHa: body?.area_ha != null ? Number(body.area_ha) : null };
    try {
      const geo = toPolygonGeoJSON(body.boundary);
      return { boundary: JSON.stringify(geo), areaHa: polygonAreaHa(geo) };
    } catch (e) {
      if (e instanceof InvalidPolygonError) throw new BadRequestException({ code: 'paddock.invalid_boundary', title: e.reason });
      throw e;
    }
  }

  async createPaddock(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'paddock.missing_name', title: 'name es obligatorio' });
    const t = this.db.tenant;
    const farm = (await this.db.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]))?.id;
    if (!farm) throw new BadRequestException({ code: 'paddock.no_farm', title: 'No hay finca para el potrero' });
    const { boundary, areaHa } = this.geometry(body);
    return this.db.one(
      `INSERT INTO paddocks (tenant_id, farm_id, name, boundary, area_ha, pasture_type, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       RETURNING id, name, boundary, area_ha::float AS area_ha, pasture_type`,
      [t, farm, name, boundary, areaHa, body?.pasture_type ?? null, this.db.user],
    );
  }

  /** Edita nombre, tipo de pastura y/o forma. Al cambiar la forma, re-deriva la superficie. */
  async updatePaddock(id: string, body: any) {
    const t = this.db.tenant;
    const existing = await this.db.one<any>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!existing) throw new NotFoundException({ code: 'paddock.not_found', title: 'Potrero no encontrado' });
    const sets: string[] = [];
    const args: any[] = [id, t];
    if (body?.name != null) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException({ code: 'paddock.missing_name', title: 'name no puede quedar vacío' });
      args.push(name);
      sets.push(`name=$${args.length}`);
    }
    if (body?.pasture_type !== undefined) {
      args.push(body.pasture_type || null);
      sets.push(`pasture_type=$${args.length}`);
    }
    if (body?.boundary !== undefined) {
      const { boundary, areaHa } = this.geometry(body);
      args.push(boundary);
      sets.push(`boundary=$${args.length}::jsonb`);
      args.push(areaHa);
      sets.push(`area_ha=$${args.length}`);
    } else if (body?.area_ha !== undefined) {
      args.push(body.area_ha != null ? Number(body.area_ha) : null);
      sets.push(`area_ha=$${args.length}`);
    }
    if (sets.length === 0) throw new BadRequestException({ code: 'paddock.no_changes', title: 'Nada para actualizar' });
    return this.db.one(
      `UPDATE paddocks SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2
       RETURNING id, name, boundary, area_ha::float AS area_ha, pasture_type`,
      args,
    );
  }

  /** Baja de un potrero. Se bloquea si tiene animales activos (moverlos primero). */
  async deletePaddock(id: string) {
    const t = this.db.tenant;
    const paddock = await this.db.one<any>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!paddock) throw new NotFoundException({ code: 'paddock.not_found', title: 'Potrero no encontrado' });
    const occ = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals WHERE current_paddock_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`,
      [id, t],
    );
    if ((occ?.n ?? 0) > 0) throw new ConflictException({ code: 'paddock.occupied', title: `El potrero tiene ${occ!.n} animales; movelos antes de borrarlo` });
    await this.db.query(`UPDATE paddocks SET is_active=false, deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, t]);
    return { id, deleted: true };
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

  /**
   * Movimiento individual/grupal (P3 M-1.d) — adaptador REST DELGADO que delega en
   * la regla única `MovementService.recordMovement(origin='web')` dentro de UNA tx.
   * La INTENCIÓN se toma por PRESENCIA de clave en el body: ausente = sin cambio;
   * `null` = limpiar; uuid = asignar. `movementId` es la clave de idempotencia
   * (Idempotency-Key del cliente o uuid fresco por request). Emite server-origin.
   * Errores de dominio (mismatch/lot|paddock.not_found/noop) suben como 400.
   */
  async moveAnimals(
    body: { animal_ids?: unknown; lot_id?: string | null; paddock_id?: string | null; reason?: string },
    movementId: string,
  ) {
    const animalIds = Array.isArray(body?.animal_ids) ? (body.animal_ids as string[]) : [];
    if (!animalIds.length) throw new BadRequestException({ code: 'movement.no_animals', title: 'animal_ids es obligatorio (1..N)' });

    const to: MovementIntent = {};
    if ('lot_id' in body) to.lot = body.lot_id ?? null;
    if ('paddock_id' in body) to.paddock = body.paddock_id ?? null;

    const res = await this.db.tx((q) =>
      this.movement.recordMovement(q, {
        animalIds,
        to,
        reason: body.reason ?? 'movimiento',
        actorUserId: this.db.user,
        origin: 'web',
        movementId,
        emitServerOrigin: true,
      }),
    );
    return { moved: res.moved, skipped: res.skipped, movement_id: movementId };
  }
}
