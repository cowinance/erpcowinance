import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { applyPut, hlcNode, HlcClock, TERMINAL_STATUS, Changeset, PutOp, RowState } from '@cowinance/sync-core';
import { computeWithdrawal, computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * Servidor de sincronización v0 sobre Postgres — misma semántica que
 * SyncServerCore de @cowinance/sync-core (verificada por la suite de
 * simulación); aquí la réplica canónica son las tablas de dominio y las
 * versiones HLC por campo viven en sync_row_state.
 *
 * Server Authority (F4.4, ADR-0007): meat_withdrawal_until/milk_withdrawal_until
 * y expected_due_date son valores DERIVADOS por reglas de dominio, no
 * preferencias del cliente. El cliente los propone (los necesita offline);
 * el servidor siempre los recalcula y, si difieren, corrige y deja traza en
 * sync_conflicts (conflict_type='semantic', resolution='server_wins',
 * auto-resuelto). Para el campo LWW (`expected_due_date`), la corrección
 * participa del mismo mecanismo de HLC que los dispositivos — ver
 * `serverClock` — para no quedar vulnerable a que un push posterior la pise.
 */

/** Columnas de animals que un changeset puede escribir (whitelist v0). */
const ANIMAL_FIELDS = new Set([
  'name',
  'status',
  'current_lot_id',
  'current_paddock_id',
  'notes',
  'birth_date',
  'sex',
  'coat_color',
  'dam_id',
  'sire_id',
]);

/** Columnas de pregnancies que un changeset puede escribir (diagnóstico/cierre offline). */
const PREGNANCY_FIELDS = new Set(['animal_id', 'status', 'diagnosis_date', 'expected_due_date', 'method', 'closed_at']);

const EVENT_TABLES = new Set(['weighings', 'animal_events', 'vaccinations', 'treatments', 'breeding_events', 'calvings', 'calving_offspring']);

@Injectable()
export class SyncService {
  /** Nodo HLC del servidor (ADR-0007): un participante más del sistema
   *  distribuido, no un caso especial — mismo mecanismo que usan los
   *  dispositivos (`new HlcClock(deviceId, ...)`), con node='server'. */
  private readonly serverClock = new HlcClock('server');

  constructor(private readonly db: DbService) {}

  async registerDevice(body: { platform: string; device_name?: string; app_version?: string }) {
    if (!['ios', 'android', 'web'].includes(body?.platform))
      throw new BadRequestException({ code: 'sync.invalid_platform', title: 'platform debe ser ios|android|web' });
    return this.db.one(
      `INSERT INTO sync_devices (tenant_id, user_id, platform, device_name, app_version)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, platform, device_name, app_version, sync_cursor, status, created_at`,
      [this.db.tenant, this.db.user, body.platform, body.device_name ?? null, body.app_version ?? null],
    );
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
          if (op.kind === 'put' && op.table === 'animals') {
            csConflicts.push(...(await this.applyAnimalPut(q, op, inserted.id)));
          } else if (op.kind === 'put' && op.table === 'pregnancies') {
            csConflicts.push(...(await this.applyPregnancyPut(q, op, inserted.id)));
          } else if (op.kind === 'event' && EVENT_TABLES.has(op.table)) {
            csConflicts.push(...(await this.applyEvent(q, op.table, op.rowId, op.row, inserted.id)));
          } else {
            throw new BadRequestException({
              code: 'sync.unsupported_op',
              title: `Operación no soportada en v0: ${op.kind} sobre ${(op as any).table}`,
            });
          }
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

  async pull(deviceId: string, cursor: number, limit = 500) {
    const device = await this.assertDevice(deviceId);
    const rows = await this.db.query<any>(
      `SELECT server_seq, sync_device_id, seq, hlc, operations
       FROM sync_changesets
       WHERE tenant_id = $1 AND server_seq > $2 AND sync_device_id != $3 AND deleted_at IS NULL
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
        seq: Number(r.seq),
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
              l.name AS lot_name,
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

  // ── Aplicación de operaciones ─────────────────────────────────────────

  private async applyAnimalPut(q: Q, op: PutOp, changesetDbId: string) {
    const conflicts: { type: string; entity_id: string; detail: string }[] = [];
    const t = this.db.tenant;

    const stateRow = await q.one<any>(
      `SELECT versions FROM sync_row_state WHERE tenant_id = $1 AND table_name = 'animals' AND row_id = $2`,
      [t, op.rowId],
    );
    const existing = await q.one<any>(`SELECT id, status FROM animals WHERE id = $1 AND tenant_id = $2`, [op.rowId, t]);
    const prev: RowState | undefined = stateRow
      ? { fields: { status: existing?.status }, versions: stateRow.versions }
      : undefined;

    // Conflicto semántico: dos estados terminales de nodos distintos
    const nextStatus = op.fields['status'];
    const prevStatusHlc = prev?.versions?.['status'];
    if (
      typeof nextStatus === 'string' &&
      TERMINAL_STATUS.has(nextStatus) &&
      typeof existing?.status === 'string' &&
      TERMINAL_STATUS.has(existing.status) &&
      prevStatusHlc &&
      hlcNode(prevStatusHlc) !== hlcNode(op.hlc)
    ) {
      conflicts.push({
        type: 'semantic',
        entity_id: op.rowId,
        detail: `Estado terminal concurrente: '${existing.status}' (previo) vs '${nextStatus}' (entrante)`,
      });
    }

    // Duplicado de campo: misma caravana visual creada para otro animal
    const tag = op.fields['visual_tag'];
    if (typeof tag === 'string') {
      const owner = await q.one<any>(
        `SELECT ai.animal_id FROM animal_identifiers ai
         WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND ai.value = $2 AND ai.deleted_at IS NULL
           AND ai.animal_id != $3 LIMIT 1`,
        [t, tag, op.rowId],
      );
      if (owner) {
        conflicts.push({
          type: 'duplicate',
          entity_id: op.rowId,
          detail: `Caravana '${tag}' ya existe en otro animal — propuesta de fusión`,
        });
      }
    }

    // LWW por campo con HLC
    const { state, changed } = applyPut(prev ?? { fields: {}, versions: {} }, op);

    if (!existing) {
      const species = await q.one<any>(`SELECT id FROM species WHERE code = 'bovine'`);
      await q.query(
        `INSERT INTO animals (id, tenant_id, farm_id, species_id, sex, origin, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'born','active',$6) ON CONFLICT (id) DO NOTHING`,
        [op.rowId, t, await this.db.defaultFarm(), species.id, (op.fields['sex'] as string) ?? 'F', this.db.user],
      );
    }

    // category_code (campo lógico del cliente) → category_id
    if (typeof op.fields['category_code'] === 'string' && changed.includes('category_code')) {
      const cat = await q.one<any>(`SELECT id FROM animal_categories WHERE code = $1`, [op.fields['category_code']]);
      if (cat)
        await q.query(`UPDATE animals SET category_id = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
          op.rowId,
          t,
          cat.id,
        ]);
    }

    const columns = changed.filter((f) => ANIMAL_FIELDS.has(f));
    if (columns.length) {
      const sets = columns.map((c, i) => `"${c}" = $${i + 3}`).join(', ');
      await q.query(`UPDATE animals SET ${sets}, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
        op.rowId,
        t,
        ...columns.map((c) => op.fields[c]),
      ]);
    }

    if (typeof tag === 'string' && changed.includes('visual_tag')) {
      await q.query(
        `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value)
         SELECT $1::uuid, $2::uuid, 'visual', $3::varchar
         WHERE NOT EXISTS (
           SELECT 1 FROM animal_identifiers WHERE animal_id = $2::uuid AND type = 'visual' AND value = $3::varchar AND deleted_at IS NULL)`,
        [t, op.rowId, tag],
      );
    }

    await q.query(
      `INSERT INTO sync_row_state (tenant_id, table_name, row_id, versions)
       VALUES ($1,'animals',$2,$3)
       ON CONFLICT (tenant_id, table_name, row_id) DO UPDATE SET versions = $3, updated_at = now()`,
      [t, op.rowId, JSON.stringify(state.versions)],
    );

    for (const c of conflicts) {
      await q.query(
        `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail)
         VALUES ($1,$2,'animals',$3,$4,$5)`,
        [t, changesetDbId, c.entity_id, c.type, c.detail],
      );
    }
    return conflicts;
  }

  /** Preñeces: el diagnóstico offline crea la fila; el parto/aborto la cierra (LWW por campo). */
  private async applyPregnancyPut(q: Q, op: PutOp, changesetDbId: string) {
    // autoResolved: true → server_wins inmediato (F4.4, no espera revisión humana).
    // false/ausente → sigue el flujo existente (pendiente en el panel de flota).
    const conflicts: { type: string; entity_id: string; detail: string; autoResolved?: boolean }[] = [];
    const t = this.db.tenant;

    const stateRow = await q.one<any>(
      `SELECT versions FROM sync_row_state WHERE tenant_id = $1 AND table_name = 'pregnancies' AND row_id = $2`,
      [t, op.rowId],
    );
    const existing = await q.one<any>(
      `SELECT id, status, animal_id, diagnosis_date FROM pregnancies WHERE id = $1 AND tenant_id = $2`,
      [op.rowId, t],
    );
    const prev: RowState | undefined = stateRow
      ? { fields: { status: existing?.status }, versions: stateRow.versions }
      : undefined;
    const { state, changed } = applyPut(prev ?? { fields: {}, versions: {} }, op);

    // Server Authority (F4.4, ADR-0007): expected_due_date es derivado, no una
    // preferencia del cliente. Si esta op lo toca (creación o corrección) y el
    // servidor conoce al animal, recalcula con la función de dominio; si
    // difiere de lo propuesto, corrige y deja traza — sin tolerancia.
    let expectedDueToWrite = (op.fields['expected_due_date'] as string | null | undefined) ?? null;
    const touchesExpectedDue = !existing ? 'expected_due_date' in op.fields : changed.includes('expected_due_date');
    if (touchesExpectedDue) {
      const animalId = (existing?.animal_id ?? op.fields['animal_id']) as string | undefined;
      const diagnosisDate = ((op.fields['diagnosis_date'] as string) ?? existing?.diagnosis_date ?? new Date().toISOString().slice(0, 10)) as string;
      if (typeof animalId === 'string') {
        const lastService = await q.one<any>(
          `SELECT occurred_at FROM breeding_events
           WHERE animal_id = $1 AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL
             AND occurred_at <= $2::date + 1
           ORDER BY occurred_at DESC LIMIT 1`,
          [animalId, diagnosisDate],
        );
        const recomputed = lastService
          ? computeExpectedDueDateFromService(new Date(lastService.occurred_at))
          : computeExpectedDueDateFromDiagnosis(new Date(diagnosisDate));

        if (recomputed !== expectedDueToWrite) {
          conflicts.push({
            type: 'semantic',
            entity_id: op.rowId,
            detail: `Server recomputation mismatch: expected_due_date client=${expectedDueToWrite ?? 'null'} server=${recomputed}`,
            autoResolved: true,
          });
          // La corrección participa del mismo mecanismo de HLC que los
          // dispositivos (no un UPDATE por fuera de él) — así un push
          // posterior con HLC menor no la pisa, y uno genuinamente más
          // nuevo del cliente sí puede ganarle (LWW correcto).
          state.versions['expected_due_date'] = this.serverClock.tick();
        }
        expectedDueToWrite = recomputed;
        state.fields['expected_due_date'] = expectedDueToWrite;
      }
    }

    if (!existing) {
      const animalId = op.fields['animal_id'];
      if (typeof animalId !== 'string')
        throw new BadRequestException({ code: 'sync.pregnancy_missing_animal', title: 'La preñez nueva requiere animal_id' });

      // Conflicto semántico: dos diagnósticos concurrentes → dos preñeces abiertas
      const open = await q.one<any>(
        `SELECT id FROM pregnancies WHERE tenant_id = $1 AND animal_id = $2 AND status = 'open' AND deleted_at IS NULL AND id != $3`,
        [t, animalId, op.rowId],
      );
      if (open && (op.fields['status'] ?? 'open') === 'open') {
        conflicts.push({
          type: 'semantic',
          entity_id: op.rowId,
          detail: 'Diagnóstico de preñez concurrente: el animal ya tiene otra preñez abierta — revisar',
        });
      }
      await q.query(
        `INSERT INTO pregnancies (id, tenant_id, animal_id, diagnosis_date, method, expected_due_date, status, closed_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [
          op.rowId,
          t,
          animalId,
          (op.fields['diagnosis_date'] as string) ?? new Date().toISOString().slice(0, 10),
          op.fields['method'] ?? 'ultrasound',
          expectedDueToWrite,
          op.fields['status'] ?? 'open',
          op.fields['closed_at'] ?? null,
          this.db.user,
        ],
      );
    } else {
      const columns = changed.filter((f) => PREGNANCY_FIELDS.has(f) && f !== 'animal_id');
      if (columns.length) {
        const sets = columns.map((c, i) => `"${c}" = $${i + 3}`).join(', ');
        await q.query(`UPDATE pregnancies SET ${sets}, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
          op.rowId,
          t,
          ...columns.map((c) => (c === 'expected_due_date' ? expectedDueToWrite : op.fields[c])),
        ]);
      }
    }

    await q.query(
      `INSERT INTO sync_row_state (tenant_id, table_name, row_id, versions)
       VALUES ($1,'pregnancies',$2,$3)
       ON CONFLICT (tenant_id, table_name, row_id) DO UPDATE SET versions = $3, updated_at = now()`,
      [t, op.rowId, JSON.stringify(state.versions)],
    );
    for (const c of conflicts) {
      await q.query(
        c.autoResolved
          ? `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail, resolution, resolved_at)
             VALUES ($1,$2,'pregnancies',$3,$4,$5,'server_wins',now())`
          : `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail)
             VALUES ($1,$2,'pregnancies',$3,$4,$5)`,
        [t, changesetDbId, c.entity_id, c.type, c.detail],
      );
    }
    return conflicts;
  }

  private async applyEvent(
    q: Q,
    table: string,
    rowId: string,
    row: Record<string, unknown>,
    changesetDbId: string,
  ): Promise<{ type: string; entity_id: string; detail: string }[]> {
    const t = this.db.tenant;
    const conflicts: { type: string; entity_id: string; detail: string }[] = [];
    if (table === 'weighings') {
      await q.query(
        `INSERT INTO weighings (id, tenant_id, animal_id, weighed_at, weight_kg, method, body_condition, device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['animal_id'],
          row['weighed_at'] ?? new Date().toISOString(),
          row['weight_kg'],
          row['method'] ?? 'scale',
          row['body_condition'] ?? null,
          null, // device_id referencia a dispositivos IoT (báscula), no al sync_device
        ],
      );
    } else if (table === 'animal_events') {
      await q.query(
        `INSERT INTO animal_events (id, tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['animal_id'],
          row['event_type'] ?? 'note',
          JSON.stringify(row['payload'] ?? {}),
          row['occurred_at'] ?? new Date().toISOString(),
          row['recorded_at'] ?? new Date().toISOString(),
        ],
      );
    } else if (table === 'vaccinations') {
      await q.query(
        `INSERT INTO vaccinations (id, tenant_id, animal_id, product_id, applied_at, dose, dose_unit, batch_number, next_due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['animal_id'],
          row['product_id'],
          row['applied_at'] ?? new Date().toISOString(),
          row['dose'] ?? null,
          row['dose_unit'] ?? null,
          row['batch_number'] ?? null,
          row['next_due_date'] ?? null,
          this.db.user,
        ],
      );
    } else if (table === 'treatments') {
      // Server Authority (F4.4, ADR-0007): meat/milk_withdrawal_until son
      // derivados por regla de dominio, no una preferencia del cliente. El
      // servidor busca el producto y recalcula; si difiere de lo propuesto,
      // usa SU valor y deja traza — sin tolerancia (inocuidad alimentaria).
      let meatWithdrawalUntil = (row['meat_withdrawal_until'] as string | null) ?? null;
      let milkWithdrawalUntil = (row['milk_withdrawal_until'] as string | null) ?? null;
      const product = await q.one<any>(
        `SELECT withdrawal_meat_days, withdrawal_milk_hours FROM products_veterinary
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [row['product_id'], t],
      );
      if (product) {
        const appliedAt = new Date((row['applied_at'] as string) ?? new Date().toISOString());
        const computed = computeWithdrawal(appliedAt, product.withdrawal_meat_days, product.withdrawal_milk_hours);
        if (computed.meatWithdrawalUntil !== meatWithdrawalUntil) {
          conflicts.push({
            type: 'semantic',
            entity_id: rowId,
            detail: `Server recomputation mismatch: meat_withdrawal_until client=${meatWithdrawalUntil ?? 'null'} server=${computed.meatWithdrawalUntil ?? 'null'}`,
          });
        }
        if (computed.milkWithdrawalUntil !== milkWithdrawalUntil) {
          conflicts.push({
            type: 'semantic',
            entity_id: rowId,
            detail: `Server recomputation mismatch: milk_withdrawal_until client=${milkWithdrawalUntil ?? 'null'} server=${computed.milkWithdrawalUntil ?? 'null'}`,
          });
        }
        meatWithdrawalUntil = computed.meatWithdrawalUntil;
        milkWithdrawalUntil = computed.milkWithdrawalUntil;
      }
      await q.query(
        `INSERT INTO treatments (id, tenant_id, animal_id, product_id, applied_at, dose, dose_unit, route, meat_withdrawal_until, milk_withdrawal_until, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['animal_id'],
          row['product_id'],
          row['applied_at'] ?? new Date().toISOString(),
          row['dose'] ?? null,
          row['dose_unit'] ?? null,
          row['route'] ?? null,
          meatWithdrawalUntil,
          milkWithdrawalUntil,
          row['notes'] ?? null,
          this.db.user,
        ],
      );
    } else if (table === 'breeding_events') {
      await q.query(
        `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, sire_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['animal_id'],
          row['type'] ?? 'heat',
          row['occurred_at'] ?? new Date().toISOString(),
          row['sire_id'] ?? null,
          row['notes'] ?? null,
          this.db.user,
        ],
      );
    } else if (table === 'calvings') {
      await q.query(
        `INSERT INTO calvings (id, tenant_id, pregnancy_id, dam_id, calving_date, ease, offspring_count, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [
          rowId,
          t,
          row['pregnancy_id'] ?? null,
          row['dam_id'],
          (row['calving_date'] as string) ?? new Date().toISOString().slice(0, 10),
          row['ease'] ?? null,
          row['offspring_count'] ?? 1,
          row['notes'] ?? null,
          this.db.user,
        ],
      );
    } else if (table === 'calving_offspring') {
      await q.query(
        `INSERT INTO calving_offspring (id, tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [rowId, t, row['calving_id'], row['animal_id'] ?? null, row['birth_weight_kg'] ?? null, row['vitality'] ?? 'live', this.db.user],
      );
    }

    for (const c of conflicts) {
      await q.query(
        `INSERT INTO sync_conflicts (tenant_id, changeset_id, entity_type, entity_id, conflict_type, detail, resolution, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,'server_wins',now())`,
        [t, changesetDbId, table, c.entity_id, c.type, c.detail],
      );
    }
    return conflicts;
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
