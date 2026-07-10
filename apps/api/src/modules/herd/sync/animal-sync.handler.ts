import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { applyPut, hlcNode, TERMINAL_STATUS } from '@cowinance/sync-core';
import type { Op, RowState } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';
import type { SyncHandler, SyncConflict } from '../../sync/contracts/sync-handler.interface';
import { SyncConflictWriter } from '../../sync/registry/sync-conflict.writer';
import { SyncVersionStore } from '../../sync/registry/sync-version.store';
import { SyncHandlerRegistry } from '../../sync/registry/sync-handler.registry';

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

/**
 * animals: aggregate root del hato (put, LWW por campo vía HLC en
 * sync_row_state). Reglas de dominio de herd: conflicto de estado terminal
 * concurrente, caravana duplicada, creación de animal offline, resolución
 * de `category_code`→`category_id`, inserción de la caravana visual.
 *
 * Vive en `herd/` (ADR-0008). Se auto-registra en `SyncHandlerRegistry` al
 * arrancar (`OnModuleInit`). La persistencia de versiones LWW y de
 * conflictos usa los servicios de infra compartidos (SyncVersionStore /
 * SyncConflictWriter); el armado del RowState queda acá porque conoce las
 * reglas del agregado.
 */
@Injectable()
export class AnimalSyncHandler implements SyncHandler, OnModuleInit {
  readonly table = 'animals' as const;

  constructor(
    private readonly db: DbService,
    private readonly versions: SyncVersionStore,
    private readonly conflictWriter: SyncConflictWriter,
    private readonly registry: SyncHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(q: Q, op: Op, changesetDbId: string): Promise<SyncConflict[]> {
    if (op.kind !== 'put') {
      throw new BadRequestException({
        code: 'sync.unsupported_op',
        title: `Operación no soportada en v0: ${op.kind} sobre ${op.table}`,
      });
    }
    const conflicts: SyncConflict[] = [];
    const t = this.db.tenant;

    const versionsMap = await this.versions.read(q, this.table, op.rowId);
    const existing = await q.one<any>(`SELECT id, status FROM animals WHERE id = $1 AND tenant_id = $2`, [op.rowId, t]);
    const prev: RowState | undefined = versionsMap
      ? { fields: { status: existing?.status }, versions: versionsMap }
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

    await this.versions.write(q, this.table, op.rowId, state.versions);
    await this.conflictWriter.write(q, changesetDbId, this.table, conflicts);
    return conflicts;
  }
}
