import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Changeset, Op } from '@cowinance/sync-core';
import { DbService } from '../../db/db.service';
import { SyncHandlerRegistry } from './registry/sync-handler.registry';

/**
 * Resultado remoto de una fila de pull (contrato con el cliente). Un changeset de
 * origen servidor (ADR-0016) viaja con `device_id` y `seq` nulos; el resto de los
 * campos no cambian. El merge del cliente opera sobre `ops`/`hlc`/`id` + `cursor`,
 * no sobre `device_id`/`seq`.
 */
export interface PulledChangesetDto {
  server_seq: number;
  device_id: string | null;
  seq: number | null;
  hlc: string;
  id: string;
  schema_version: number;
  ops: Op[];
}

/** Fila cruda de sync_changesets tal como la lee el pull. */
interface SyncChangesetRow {
  server_seq: number | string;
  sync_device_id: string | null;
  seq: number | string | null;
  hlc: string;
  operations: { client_id: string; schema_version?: number; ops?: Op[] };
}

/**
 * Servidor de sincronización v0 sobre Postgres — orquestación del protocolo
 * de sync (registro de dispositivos, push/pull, bootstrap, panel de flota,
 * resolución de conflictos). **No contiene reglas de dominio** (F6): cada
 * operación de un changeset se despacha al `SyncHandler` de su tabla, que
 * vive en el módulo dueño del bounded context (ADR-0008). La semántica de
 * merge (LWW por campo vía HLC) la aporta @cowinance/sync-core; la réplica
 * canónica son las tablas de dominio y las versiones por campo viven en
 * sync_row_state.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly db: DbService,
    private readonly handlers: SyncHandlerRegistry,
  ) {}

  async registerDevice(body: { platform: string; device_name?: string; app_version?: string }) {
    if (!['ios', 'android', 'web'].includes(body?.platform))
      throw new BadRequestException({ code: 'sync.invalid_platform', title: 'platform debe ser ios|android|web' });
    return this.db.one(
      `INSERT INTO sync_devices (tenant_id, user_id, platform, device_name, app_version)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, platform, device_name, app_version, sync_cursor, status, created_at`,
      [this.db.tenant, this.db.user, body.platform, body.device_name ?? null, body.app_version ?? null],
    );
  }

  /**
   * Registra el push token de un device del usuario (P7-2.a). Idempotente; aislado por
   * tenant + usuario (no toca el device de otro). Un token pertenece a UN device: al
   * registrarlo se limpia de otras filas del mismo usuario (una reinstalación lo mueve). El
   * transporte push (fase posterior) lee `sync_devices.push_token` de los devices activos.
   */
  async setPushToken(deviceId: string, pushToken: string) {
    const t = this.db.tenant;
    if (!pushToken || typeof pushToken !== 'string')
      throw new BadRequestException({ code: 'sync.missing_push_token', title: 'push_token es obligatorio' });
    const device = await this.db.one<{ id: string }>(
      `SELECT id FROM sync_devices WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [deviceId, t, this.db.user],
    );
    if (!device) throw new NotFoundException({ code: 'sync.device_not_found', title: 'Dispositivo no encontrado' });
    // Un token, un device: lo despega de cualquier otra fila del usuario antes de asignarlo.
    await this.db.query(
      `UPDATE sync_devices SET push_token = NULL, updated_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND push_token = $3 AND id <> $4`,
      [t, this.db.user, pushToken, deviceId],
    );
    await this.db.query(`UPDATE sync_devices SET push_token = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [pushToken, deviceId, t]);
    return { id: deviceId, push_token_registered: true };
  }

  async push(body: { device_id: string; changesets: Changeset[] }) {
    const device = await this.assertDevice(body?.device_id);
    if (!Array.isArray(body.changesets) || !body.changesets.length)
      throw new BadRequestException({ code: 'sync.empty_push', title: 'changesets vacío' });

    let accepted = 0;
    let deduped = 0;
    const conflicts: { type: string; entity_id: string; detail: string }[] = [];

    for (const cs of [...body.changesets].sort((a, b) => a.seq - b.seq)) {
      // Atómico: el changeset se registra y aplica completo, o nada (reintenta el cliente).
      // db.tx() serializa la conexión y hace rollback si algo lanza.
      const result = await this.db.tx(async (q) => {
        const inserted = await q.one<{ id: string }>(
          `INSERT INTO sync_changesets (tenant_id, sync_device_id, seq, hlc, operations, status, received_at, applied_at)
           VALUES ($1,$2,$3,$4,$5,'applied',now(),now())
           ON CONFLICT (sync_device_id, seq) DO NOTHING RETURNING id`,
          [this.db.tenant, device.id, cs.seq, cs.hlc, JSON.stringify({ client_id: cs.id, schema_version: cs.schemaVersion, ops: cs.ops })],
        );
        if (!inserted) return { deduped: true as const, conflicts: [] };

        const csConflicts: { type: string; entity_id: string; detail: string }[] = [];
        for (const op of cs.ops ?? []) {
          // Cada tabla la aplica el SyncHandler de su módulo dueño (ADR-0008);
          // sync.service solo orquesta. Sin handler registrado → op no soportada.
          const handler = this.handlers.get(op.table);
          if (!handler) {
            throw new BadRequestException({
              code: 'sync.unsupported_op',
              title: `Operación no soportada en v0: ${op.kind} sobre ${(op as any).table}`,
            });
          }
          csConflicts.push(...(await handler.apply(q, op, inserted.id)));
        }
        return { deduped: false as const, conflicts: csConflicts };
      });

      if (result.deduped) {
        deduped++; // reintento del cliente → exactly-once
      } else {
        accepted++;
        conflicts.push(...result.conflicts);
      }
    }

    await this.db.query(`UPDATE sync_devices SET last_sync_at = now(), updated_at = now() WHERE id = $1`, [device.id]);
    const cursor = await this.globalCursor();
    return { accepted, deduped, conflicts, server_cursor: cursor };
  }

  async pull(deviceId: string, cursor: number, limit = 500): Promise<{ changesets: PulledChangesetDto[]; cursor: number }> {
    const device = await this.assertDevice(deviceId);
    // IS DISTINCT FROM (no !=): un changeset de origen servidor tiene
    // sync_device_id NULL y debe entregarse a TODOS los dispositivos; `!=` lo
    // excluiría (NULL != x → NULL, no true). Para filas de dispositivo el
    // comportamiento es idéntico a `!=` (ADR-0016).
    const rows = await this.db.query<SyncChangesetRow>(
      `SELECT server_seq, sync_device_id, seq, hlc, operations
       FROM sync_changesets
       WHERE tenant_id = $1 AND server_seq > $2 AND sync_device_id IS DISTINCT FROM $3 AND deleted_at IS NULL
       ORDER BY server_seq LIMIT $4`,
      [this.db.tenant, cursor, device.id, limit],
    );
    const nextCursor = rows.length === limit ? Number(rows[rows.length - 1].server_seq) : await this.globalCursor();
    await this.db.query(
      `UPDATE sync_devices SET sync_cursor = $2, last_sync_at = now(), updated_at = now() WHERE id = $1`,
      [device.id, nextCursor],
    );
    return {
      changesets: rows.map((r) => ({
        server_seq: Number(r.server_seq),
        device_id: r.sync_device_id,
        seq: r.seq == null ? null : Number(r.seq),
        hlc: r.hlc,
        id: r.operations?.client_id,
        schema_version: r.operations?.schema_version ?? 1,
        ops: r.operations?.ops ?? [],
      })),
      cursor: nextCursor,
    };
  }

  /**
   * Snapshot inicial (suscripción parcial v0): hidrata la base local del
   * dispositivo con el estado actual + versiones HLC por campo. Después de
   * esto, el dispositivo solo intercambia changesets incrementales.
   */
  async bootstrap(deviceId: string) {
    await this.assertDevice(deviceId);
    const cursor = await this.globalCursor();
    const rows = await this.db.query<any>(
      `SELECT a.id, a.name, a.status, a.sex, a.birth_date, a.notes,
              c.code AS category_code, c.name AS category,
              a.current_lot_id, a.current_paddock_id, l.name AS lot_name,
              ai.value AS visual_tag,
              w.weight_kg::float AS last_weight_kg, w.weighed_at AS last_weighed_at,
              rs.versions
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN LATERAL (
         SELECT weight_kg, weighed_at FROM weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL
         ORDER BY weighed_at DESC LIMIT 1) w ON true
       LEFT JOIN sync_row_state rs ON rs.tenant_id = a.tenant_id AND rs.table_name = 'animals' AND rs.row_id = a.id
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.status = 'active'`,
      [this.db.tenant],
    );
    const farm = await this.db.one<any>(`SELECT id, name FROM farms WHERE id = $1`, [await this.db.defaultFarm()]);

    const products = await this.db.query<any>(
      `SELECT id, name, type, withdrawal_meat_days, withdrawal_milk_hours, default_dose
       FROM products_veterinary WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const pregnancies = await this.db.query<any>(
      `SELECT p.id, p.animal_id, p.diagnosis_date, p.method, p.expected_due_date, p.status, rs.versions
       FROM pregnancies p
       LEFT JOIN sync_row_state rs ON rs.tenant_id = p.tenant_id AND rs.table_name = 'pregnancies' AND rs.row_id = p.id
       WHERE p.tenant_id = $1 AND p.status = 'open' AND p.deleted_at IS NULL`,
      [this.db.tenant],
    );
    // Catálogo de lotes (P3 M-3.1): destino de movimientos offline en el móvil. Solo
    // transporte — el potrero deriva del lote; sin reglas de dominio aquí.
    const lots = await this.db.query<any>(
      `SELECT l.id, l.name, l.current_paddock_id, p.name AS paddock_name
       FROM lots l
       LEFT JOIN paddocks p ON p.id = l.current_paddock_id
       WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND l.is_active
       ORDER BY l.name`,
      [this.db.tenant],
    );
    // Tareas pendientes (P6-1.b): entidad mutable sincronizada (put/LWW). Incluye las de
    // Sanidad → permite completarlas offline. El potrero/regla no aplican; solo transporte.
    const tasks = await this.db.query<any>(
      `SELECT tk.id, tk.title, tk.description, tk.type, tk.status, tk.due_date, tk.priority, tk.related_type, tk.related_id, tk.completed_at, rs.versions
       FROM tasks tk
       LEFT JOIN sync_row_state rs ON rs.tenant_id = tk.tenant_id AND rs.table_name = 'tasks' AND rs.row_id = tk.id
       WHERE tk.tenant_id = $1 AND tk.status = 'pending' AND tk.deleted_at IS NULL`,
      [this.db.tenant],
    );

    const bootstrapRows = [
      ...rows.map((r) => ({
        table: 'animals',
        rowId: r.id,
        state: {
          fields: {
            visual_tag: r.visual_tag,
            name: r.name,
            status: r.status,
            sex: r.sex,
            birth_date: r.birth_date,
            notes: r.notes,
            category: r.category,
            category_code: r.category_code,
            current_lot_id: r.current_lot_id,
            current_paddock_id: r.current_paddock_id,
            lot_name: r.lot_name,
            last_weight_kg: r.last_weight_kg,
            last_weighed_at: r.last_weighed_at,
          },
          versions: r.versions ?? {},
        },
      })),
      ...pregnancies.map((p) => ({
        table: 'pregnancies',
        rowId: p.id,
        state: {
          fields: {
            animal_id: p.animal_id,
            status: p.status,
            diagnosis_date: p.diagnosis_date,
            method: p.method,
            expected_due_date: p.expected_due_date,
          },
          versions: p.versions ?? {},
        },
      })),
      // Catálogo (solo lectura en el cliente)
      ...products.map((p) => ({
        table: 'products_veterinary',
        rowId: p.id,
        state: {
          fields: {
            name: p.name,
            type: p.type,
            withdrawal_meat_days: p.withdrawal_meat_days,
            withdrawal_milk_hours: p.withdrawal_milk_hours,
            default_dose: p.default_dose,
          },
          versions: {},
        },
      })),
      ...lots.map((l) => ({
        table: 'lots',
        rowId: l.id,
        state: {
          fields: {
            name: l.name,
            current_paddock_id: l.current_paddock_id,
            paddock_name: l.paddock_name,
          },
          versions: {},
        },
      })),
      ...tasks.map((tk) => ({
        table: 'tasks',
        rowId: tk.id,
        state: {
          fields: {
            title: tk.title,
            description: tk.description,
            type: tk.type,
            status: tk.status,
            due_date: tk.due_date,
            priority: tk.priority,
            related_type: tk.related_type,
            related_id: tk.related_id,
            completed_at: tk.completed_at,
          },
          versions: tk.versions ?? {},
        },
      })),
    ];

    return { cursor, farm, rows: bootstrapRows };
  }

  /** Panel de flota (doc Catálogo A4). */
  async state() {
    const [devices, cursor, openConflicts] = await Promise.all([
      this.db.query(
        `SELECT d.id, d.platform, d.device_name, d.app_version, d.last_sync_at, d.sync_cursor::int, d.status,
                (SELECT count(*)::int FROM sync_changesets c WHERE c.sync_device_id = d.id) AS changesets_pushed
         FROM sync_devices d WHERE d.tenant_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at`,
        [this.db.tenant],
      ),
      this.globalCursor(),
      this.db.one<any>(`SELECT count(*)::int AS n FROM sync_conflicts WHERE tenant_id = $1 AND resolved_at IS NULL`, [
        this.db.tenant,
      ]),
    ]);
    return { devices, server_cursor: cursor, open_conflicts: openConflicts?.n ?? 0 };
  }

  async conflicts() {
    return this.db.query(
      `SELECT c.id, c.conflict_type, c.entity_type, c.entity_id, c.detail, c.resolution, c.resolved_at, c.created_at,
              ai.value AS tag
       FROM sync_conflicts c
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x WHERE x.animal_id = c.entity_id AND x.type='visual'
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
       ORDER BY (c.resolved_at IS NULL) DESC, c.created_at DESC LIMIT 100`,
      [this.db.tenant],
    );
  }

  async resolve(body: { conflict_id: string; resolution: string }) {
    if (!['server_wins', 'client_wins', 'merged', 'manual'].includes(body?.resolution))
      throw new BadRequestException({ code: 'sync.invalid_resolution', title: 'resolution inválida' });
    const row = await this.db.one(
      `UPDATE sync_conflicts SET resolution = $3, resolved_by = $4, resolved_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND resolved_at IS NULL RETURNING id, resolution, resolved_at`,
      [body.conflict_id, this.db.tenant, body.resolution, this.db.user],
    );
    if (!row) throw new NotFoundException({ code: 'sync.conflict_not_found', title: 'Conflicto no encontrado o ya resuelto' });
    return row;
  }

  private async globalCursor(): Promise<number> {
    const r = await this.db.one<any>(
      `SELECT COALESCE(max(server_seq), 0)::int AS c FROM sync_changesets WHERE tenant_id = $1`,
      [this.db.tenant],
    );
    return r?.c ?? 0;
  }

  private async assertDevice(id: string) {
    if (!id) throw new BadRequestException({ code: 'sync.missing_device', title: 'device_id es obligatorio' });
    const device = await this.db.one<any>(
      `SELECT id, status FROM sync_devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!device) throw new NotFoundException({ code: 'sync.device_not_found', title: 'Dispositivo no registrado' });
    if (device.status !== 'active')
      throw new BadRequestException({ code: 'sync.device_revoked', title: 'Dispositivo revocado' });
    return device;
  }
}
