import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvalidCryoLocationError,
  validateCanister,
  validateGoblet,
  validateTank,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Termos, canastas y gobeletes (GT-1): la UBICACIÓN física de lo que está congelado.
 *
 * Este servicio no sabe nada de pajuelas — solo de dónde caben. El contenido llega en GT-2, y esa
 * separación es a propósito: la estructura del termo cambia una vez al año (se compra un termo, se
 * suma una canasta) y el contenido cambia todas las semanas. Mezclarlas obligaría a tocar la
 * estructura cada vez que se mueve una pajuela.
 *
 * La capacidad se controla al crear, no al leer: un termo de 6 canastas no acepta la séptima. Es la
 * clase de error que en papel se descubre frente al termo abierto, con el nitrógeno evaporándose.
 */
@Injectable()
export class CryoStorageService {
  constructor(private readonly db: DbService) {}

  private dominio<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidCryoLocationError)
        throw new BadRequestException({ code: 'genetics.invalid_cryo_location', title: e.message });
      throw e;
    }
  }

  // ─────────────────────────────── Termos ───────────────────────────────

  /**
   * Listado con el conteo de canastas ya calculado. Va en la misma consulta y no en un `n+1` desde
   * la UI porque la pregunta «¿cuántas canastas tiene?» se hace SIEMPRE que se lista un termo: es
   * lo que dice si queda lugar.
   */
  async listTanks() {
    const r = await this.db.query<any>(
      `SELECT t.id, t.code, t.name, t.serial_number, t.canister_capacity, t.notes,
              count(c.id)::int AS canister_count
       FROM storage_tanks t
       LEFT JOIN cryo_canisters c ON c.tank_id = t.id AND c.deleted_at IS NULL
       WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.code NULLS LAST, t.created_at`,
      [this.db.tenant],
    );
    return r;
  }

  /** Un termo con su árbol completo: es la vista que se mira parado frente al termo. */
  async getTank(id: string) {
    const tank = await this.db.one<any>(
      `SELECT id, code, name, serial_number, canister_capacity, notes
       FROM storage_tanks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!tank) throw new NotFoundException({ code: 'genetics.tank_not_found', title: 'Termo no encontrado' });

    const canisters = await this.db.query<any>(
      `SELECT c.id, c.code, c.color, c.goblet_capacity, c.notes, count(g.id)::int AS goblet_count
       FROM cryo_canisters c
       LEFT JOIN cryo_goblets g ON g.canister_id = c.id AND g.deleted_at IS NULL
       WHERE c.tank_id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY c.code`,
      [id, this.db.tenant],
    );

    const goblets = await this.db.query<any>(
      `SELECT g.id, g.canister_id, g.code, g.color, g.notes
       FROM cryo_goblets g
       JOIN cryo_canisters c ON c.id = g.canister_id AND c.deleted_at IS NULL
       WHERE c.tank_id = $1 AND g.tenant_id = $2 AND g.deleted_at IS NULL
       ORDER BY g.code`,
      [id, this.db.tenant],
    );

    return {
      // `canister_count` también acá: el listado lo devuelve y la cabecera del detalle lo muestra.
      // Sin él la pantalla decía «undefined canastas» en cuanto el termo no tenía capacidad fijada.
      ...tank,
      canister_count: canisters.length,
      canisters: canisters.map((c) => ({ ...c, goblets: goblets.filter((g) => g.canister_id === c.id) })),
    };
  }

  async createTank(body: any) {
    const input = this.dominio(() => validateTank(body));
    await this.requireCodigoLibre('storage_tanks', 'tenant_id', this.db.tenant, input.code, null);
    const farm = await this.db.defaultFarm();
    const r = await this.db.query<any>(
      `INSERT INTO storage_tanks (tenant_id, farm_id, code, name, serial_number, canister_capacity, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, code, name, serial_number, canister_capacity, notes`,
      [this.db.tenant, farm, input.code, input.name, input.serial_number, input.canister_capacity, input.notes, this.db.user],
    );
    return { ...r[0], canister_count: 0 };
  }

  async updateTank(id: string, body: any) {
    const actual = await this.db.one<any>(
      `SELECT id FROM storage_tanks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!actual) throw new NotFoundException({ code: 'genetics.tank_not_found', title: 'Termo no encontrado' });

    const input = this.dominio(() => validateTank(body));
    await this.requireCodigoLibre('storage_tanks', 'tenant_id', this.db.tenant, input.code, id);

    // Bajar la capacidad por debajo de lo ya cargado dejaría el termo en un estado que el propio
    // sistema no habría permitido crear. Se rechaza en vez de aceptar una capacidad que miente.
    if (input.canister_capacity !== null) await this.requireCabe(id, input.canister_capacity);

    const r = await this.db.query<any>(
      `UPDATE storage_tanks SET code=$3, name=$4, serial_number=$5, canister_capacity=$6, notes=$7, updated_at=now()
       WHERE id=$1 AND tenant_id=$2
       RETURNING id, code, name, serial_number, canister_capacity, notes`,
      [id, this.db.tenant, input.code, input.name, input.serial_number, input.canister_capacity, input.notes],
    );
    return r[0];
  }

  /**
   * Un termo con canastas no se borra. No es una restricción técnica —la FK es RESTRICT igual—:
   * borrar el termo dejaría las canastas y su contenido sin lugar, o sea pajuelas que el sistema
   * cree que existen y nadie puede encontrar. Primero se vacía.
   */
  async deleteTank(id: string) {
    const usado = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_canisters WHERE tank_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if ((usado?.n ?? 0) > 0)
      throw new ConflictException({
        code: 'genetics.tank_not_empty',
        title: 'El termo todavía tiene canastas. Quitalas antes de darlo de baja.',
      });
    const r = await this.db.query(
      `UPDATE storage_tanks SET deleted_at = now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (r.length === 0) throw new NotFoundException({ code: 'genetics.tank_not_found', title: 'Termo no encontrado' });
    return { ok: true };
  }

  // ────────────────────────────── Canastas ──────────────────────────────

  async createCanister(tankId: string, body: any) {
    const tank = await this.db.one<any>(
      `SELECT id, canister_capacity FROM storage_tanks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [tankId, this.db.tenant],
    );
    if (!tank) throw new NotFoundException({ code: 'genetics.tank_not_found', title: 'Termo no encontrado' });

    const input = this.dominio(() => validateCanister(body));
    if (tank.canister_capacity !== null) await this.requireCabe(tankId, tank.canister_capacity, 1);
    await this.requireCodigoLibre('cryo_canisters', 'tank_id', tankId, input.code, null);

    const r = await this.db.query<any>(
      `INSERT INTO cryo_canisters (tenant_id, tank_id, code, color, goblet_capacity, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, code, color, goblet_capacity, notes`,
      [this.db.tenant, tankId, input.code, input.color, input.goblet_capacity, input.notes, this.db.user],
    );
    return { ...r[0], goblet_count: 0 };
  }

  async updateCanister(id: string, body: any) {
    const actual = await this.db.one<any>(
      `SELECT id, tank_id FROM cryo_canisters WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!actual) throw new NotFoundException({ code: 'genetics.canister_not_found', title: 'Canasta no encontrada' });

    const input = this.dominio(() => validateCanister(body));
    await this.requireCodigoLibre('cryo_canisters', 'tank_id', actual.tank_id, input.code, id);

    const r = await this.db.query<any>(
      `UPDATE cryo_canisters SET code=$3, color=$4, goblet_capacity=$5, notes=$6, updated_at=now()
       WHERE id=$1 AND tenant_id=$2
       RETURNING id, code, color, goblet_capacity, notes`,
      [id, this.db.tenant, input.code, input.color, input.goblet_capacity, input.notes],
    );
    return r[0];
  }

  async deleteCanister(id: string) {
    const usado = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_goblets WHERE canister_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if ((usado?.n ?? 0) > 0)
      throw new ConflictException({
        code: 'genetics.canister_not_empty',
        title: 'La canasta todavía tiene gobeletes. Quitalos antes de sacarla.',
      });
    const r = await this.db.query(
      `UPDATE cryo_canisters SET deleted_at = now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (r.length === 0) throw new NotFoundException({ code: 'genetics.canister_not_found', title: 'Canasta no encontrada' });
    return { ok: true };
  }

  // ────────────────────────────── Gobeletes ─────────────────────────────

  async createGoblet(canisterId: string, body: any) {
    const can = await this.db.one<any>(
      `SELECT id, goblet_capacity FROM cryo_canisters WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [canisterId, this.db.tenant],
    );
    if (!can) throw new NotFoundException({ code: 'genetics.canister_not_found', title: 'Canasta no encontrada' });

    const input = this.dominio(() => validateGoblet(body));
    if (can.goblet_capacity !== null) {
      const n = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM cryo_goblets WHERE canister_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [canisterId, this.db.tenant],
      );
      if ((n?.n ?? 0) + 1 > can.goblet_capacity)
        throw new ConflictException({
          code: 'genetics.canister_full',
          title: `La canasta admite ${can.goblet_capacity} gobeletes y ya tiene ${n?.n ?? 0}.`,
        });
    }
    await this.requireCodigoLibre('cryo_goblets', 'canister_id', canisterId, input.code, null);

    const r = await this.db.query<any>(
      `INSERT INTO cryo_goblets (tenant_id, canister_id, code, color, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, canister_id, code, color, notes`,
      [this.db.tenant, canisterId, input.code, input.color, input.notes, this.db.user],
    );
    return r[0];
  }

  async updateGoblet(id: string, body: any) {
    const actual = await this.db.one<any>(
      `SELECT id, canister_id FROM cryo_goblets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!actual) throw new NotFoundException({ code: 'genetics.goblet_not_found', title: 'Gobelete no encontrado' });

    const input = this.dominio(() => validateGoblet(body));
    await this.requireCodigoLibre('cryo_goblets', 'canister_id', actual.canister_id, input.code, id);

    const r = await this.db.query<any>(
      `UPDATE cryo_goblets SET code=$3, color=$4, notes=$5, updated_at=now()
       WHERE id=$1 AND tenant_id=$2
       RETURNING id, canister_id, code, color, notes`,
      [id, this.db.tenant, input.code, input.color, input.notes],
    );
    return r[0];
  }

  async deleteGoblet(id: string) {
    const r = await this.db.query(
      `UPDATE cryo_goblets SET deleted_at = now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (r.length === 0) throw new NotFoundException({ code: 'genetics.goblet_not_found', title: 'Gobelete no encontrado' });
    return { ok: true };
  }

  // ─────────────────────────────── Apoyo ────────────────────────────────

  /**
   * El código repetido se rechaza con un mensaje, no con el error del índice único. El índice está
   * igual —es el que garantiza la unicidad bajo concurrencia—, pero un 409 explicado es lo que
   * permite corregirlo sin adivinar.
   */
  private async requireCodigoLibre(tabla: string, ambitoCol: string, ambito: string, code: string, exceptoId: string | null) {
    const dup = await this.db.one<{ id: string }>(
      `SELECT id FROM ${tabla}
       WHERE ${ambitoCol} = $1 AND lower(code) = lower($2) AND deleted_at IS NULL
         AND ($3::uuid IS NULL OR id <> $3::uuid)
       LIMIT 1`,
      [ambito, code, exceptoId],
    );
    if (dup)
      throw new ConflictException({
        code: 'genetics.duplicate_code',
        title: `Ya existe algo con el código "${code}" en ese lugar.`,
      });
  }

  private async requireCabe(tankId: string, capacidad: number, sumar = 0) {
    const n = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_canisters WHERE tank_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [tankId, this.db.tenant],
    );
    const total = (n?.n ?? 0) + sumar;
    if (total > capacidad)
      throw new ConflictException({
        code: 'genetics.tank_full',
        title: `El termo admite ${capacidad} canastas y ya tiene ${n?.n ?? 0}.`,
      });
  }
}
