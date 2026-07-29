import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InvalidLotError, InvalidPolygonError, polygonAreaHa, toPolygonGeoJSON, validateLotInput } from '@cowinance/domain';
import { DbService, type Q } from '../../db/db.service';
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

    // Regla de negocio: no se mueven animales a un lote archivado.
    if (body?.lot_id) {
      const lot = await this.db.one<{ id: string }>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [body.lot_id, this.db.tenant]);
      if (!lot) throw new ConflictException({ code: 'movement.lot_archived', title: 'El lote de destino está archivado o no existe' });
    }

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

  /** Verifica que el lote destino exista y esté activo (no archivado). Devuelve su nombre. */
  private async assertActiveLot(q: Q, lotId: string): Promise<string> {
    const l = await q.one<{ name: string }>(`SELECT name FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [lotId, this.db.tenant]);
    if (!l) throw new ConflictException({ code: 'lot.archived_or_missing', title: 'El lote de destino está archivado o no existe' });
    return l.name;
  }

  /**
   * Mueve TODOS los animales activos de un lote a otro (rodeo completo). Reusa la regla única
   * `recordMovement` en UNA tx — sin update directo de current_lot_id. `movementId` idempotente.
   */
  async moveAllAnimals(fromLotId: string, body: { target_lot_id?: string; reason?: string }, movementId: string) {
    const target = body?.target_lot_id;
    if (!target) throw new BadRequestException({ code: 'lot.no_target', title: 'target_lot_id es obligatorio' });
    if (target === fromLotId) throw new BadRequestException({ code: 'lot.same', title: 'El lote de destino no puede ser el mismo' });
    return this.db.tx(async (q) => {
      const src = await q.one<{ id: string }>(`SELECT id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [fromLotId, this.db.tenant]);
      if (!src) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
      const to = await this.assertActiveLot(q, target);
      const animals = await q.query<{ id: string }>(`SELECT id FROM animals WHERE current_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`, [fromLotId, this.db.tenant]);
      if (!animals.length) throw new ConflictException({ code: 'lot.empty', title: 'El lote no tiene animales para mover' });
      const res = await this.movement.recordMovement(q, {
        animalIds: animals.map((a) => a.id), to: { lot: target }, reason: body.reason ?? 'mover lote completo',
        actorUserId: this.db.user, origin: 'web', movementId, emitServerOrigin: true,
      });
      return { moved: res.moved, to };
    });
  }

  /** Fusiona un lote en otro: mueve todos sus animales al destino y ARCHIVA el lote origen (queda vacío). */
  async mergeLots(fromLotId: string, body: { target_lot_id?: string; reason?: string }, movementId: string) {
    const target = body?.target_lot_id;
    if (!target) throw new BadRequestException({ code: 'lot.no_target', title: 'target_lot_id es obligatorio' });
    if (target === fromLotId) throw new BadRequestException({ code: 'lot.same', title: 'No se puede fusionar un lote consigo mismo' });
    return this.db.tx(async (q) => {
      const src = await q.one<{ id: string; name: string }>(`SELECT id, name FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [fromLotId, this.db.tenant]);
      if (!src) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });
      const to = await this.assertActiveLot(q, target);
      const animals = await q.query<{ id: string }>(`SELECT id FROM animals WHERE current_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`, [fromLotId, this.db.tenant]);
      if (animals.length) {
        await this.movement.recordMovement(q, {
          animalIds: animals.map((a) => a.id), to: { lot: target }, reason: body.reason ?? `fusión con ${to}`,
          actorUserId: this.db.user, origin: 'web', movementId, emitServerOrigin: true,
        });
      }
      // El origen queda vacío → se archiva en la misma tx (consistente).
      await q.query(`UPDATE lots SET is_active=false, deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2`, [fromLotId, this.db.tenant]);
      return { merged: animals.length, from: src.name, into: to };
    });
  }

  /**
   * Divide un lote en dos: crea un lote nuevo y mueve ahí los animales indicados.
   *
   * **Los animales tienen que ser DE ESTE LOTE.** No lo eran: la función recibía una lista de ids y
   * se los pasaba a `recordMovement` sin mirar de dónde salían, así que «dividir el lote A» podía
   * sacar animales del lote B. Comprobado contra la app: una división de «Rodeo Cría 1» se llevó un
   * animal de «Recría 2026», y el historial lo registró como una división normal. El comentario que
   * estaba acá ya decía «(subconjunto del origen)» — describía la regla, y nadie la aplicaba.
   *
   * Se rechaza la operación ENTERA si alguno no pertenece, en vez de filtrar y mover el resto: la
   * lista sale de una pantalla que mostraba este lote, así que un id ajeno significa que lo que el
   * productor está mirando ya no es lo que hay. Mover «los que sí» dejaría una división a medias que
   * nadie pidió y que no se ve.
   */
  async splitLot(fromLotId: string, body: { name?: unknown; purpose?: unknown; animal_ids?: unknown; reason?: string }, movementId: string) {
    let input;
    try {
      input = validateLotInput(body);
    } catch (e) {
      if (e instanceof InvalidLotError) throw new BadRequestException({ code: 'lot.invalid', title: e.reason });
      throw e;
    }
    // Sin repetidos: el mismo animal dos veces en la lista no puede contar dos veces al comparar
    // contra los que de verdad están en el lote.
    const animalIds = Array.isArray(body?.animal_ids) ? [...new Set(body.animal_ids as string[])] : [];
    if (!animalIds.length) throw new BadRequestException({ code: 'lot.no_animals', title: 'Elegí al menos un animal para el nuevo lote' });

    return this.db.tx(async (q) => {
      // `FOR UPDATE` como en fusionar y mover-todo: serializa dos divisiones del mismo lote. Sin el
      // lock, las dos comprueban la pertenencia contra el mismo estado y la segunda vuelve a mover
      // animales que la primera ya sacó.
      const src = await q.one<{ farm_id: string }>(
        `SELECT farm_id FROM lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [fromLotId, this.db.tenant],
      );
      if (!src) throw new NotFoundException({ code: 'lot.not_found', title: 'Lote no encontrado' });

      /*
       * REINTENTO: si esta misma operación ya se hizo, se devuelve el lote que creó.
       *
       * El `Idempotency-Key` protegía el movimiento pero no la creación del lote: `recordMovement`
       * deduplicaba por `movement_id` mientras el `INSERT INTO lots` corría igual, así que un doble
       * envío —un toque repetido, una reconexión en el campo— dejaba DOS lotes, el segundo vacío.
       * Comprobado: dos llamadas con la misma clave devolvieron `moved: 1` y `moved: 0`, y quedaron
       * los dos lotes en la lista.
       */
      const yaHecho = await q.one<{ to_lot_id: string; n: number }>(
        `SELECT to_lot_id, count(*)::int AS n FROM animal_movements
          WHERE tenant_id=$1 AND movement_id=$2 AND to_lot_id IS NOT NULL AND deleted_at IS NULL
          GROUP BY to_lot_id LIMIT 1`,
        [this.db.tenant, movementId],
      );
      if (yaHecho) {
        const lot = await q.one<{ id: string; name: string }>(`SELECT id, name FROM lots WHERE id=$1 AND tenant_id=$2`, [yaHecho.to_lot_id, this.db.tenant]);
        return { new_lot_id: yaHecho.to_lot_id, name: lot?.name ?? null, moved: yaHecho.n, already: true };
      }

      // Los que DE VERDAD están en este lote. Mismo criterio que mover-todo y fusionar: activos y no
      // borrados — mover un animal muerto a un lote nuevo no significa nada.
      const enElLote = await q.query<{ id: string }>(
        `SELECT id FROM animals WHERE current_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL AND id = ANY($3::uuid[])`,
        [fromLotId, this.db.tenant, animalIds],
      );
      if (enElLote.length !== animalIds.length) {
        // El texto lo lee el productor parado en el corral: se escribe como se habla, y por eso
        // distingue uno de varios y «ninguno» de «algunos». «1 de los 1 animales ya no están» es la
        // clase de frase que hace dudar de si el sistema entendió lo que se le pidió.
        const faltan = animalIds.length - enElLote.length;
        const total = animalIds.length;
        const detalle =
          total === 1
            ? 'El animal elegido ya no está en este lote'
            : faltan === total
              ? `Ninguno de los ${total} animales elegidos está en este lote`
              : `${faltan} de los ${total} animales elegidos ${faltan === 1 ? 'ya no está' : 'ya no están'} en este lote`;
        throw new ConflictException({
          code: 'lot.animals_not_in_lot',
          title: `${detalle}. Actualizá la lista y volvé a intentar.`,
        });
      }

      const newLot = await q.one<{ id: string; name: string }>(
        `INSERT INTO lots (tenant_id, farm_id, name, purpose, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name`,
        [this.db.tenant, src.farm_id, input.name, input.purpose, this.db.user],
      );
      const res = await this.movement.recordMovement(q, {
        animalIds, to: { lot: newLot!.id }, reason: body.reason ?? 'división de lote',
        actorUserId: this.db.user, origin: 'web', movementId, emitServerOrigin: true,
      });
      return { new_lot_id: newLot!.id, name: newLot!.name, moved: res.moved };
    });
  }
}
