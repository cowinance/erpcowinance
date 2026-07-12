import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { ImportClaimRepository } from './import-claim.repository';
import { AnimalWriteService } from '../herd/animal-write.service';
import { buildRawRow } from './mapping';
import type { AnimalImportField } from '../herd/animal-import-descriptor';

const POLL_INTERVAL_MS = 1_000;
const CHUNK_SIZE = 500;

type Mapping = Partial<Record<AnimalImportField, string>>;

/**
 * Procesador de importación (P2 P-c.2) — create-pass. Poller (como OutboxRelay)
 * que reclama un batch (ImportClaimRepository) y lo procesa por chunks en
 * transacciones tenant-scoped INDEPENDIENTES, fuera del request.
 *
 * Semántica de errores (aprobada): la validación esperable ocurre ANTES de
 * persistir (→ invalid/skipped, sin lanzar SQL); un error SQL INESPERADO aborta y
 * REVIERTE el chunk completo — el batch queda en `processing` y el heartbeat
 * vencido lo hará reclamar de nuevo (reintento). NO se transiciona a `failed`
 * (no hay política de máximo de intentos todavía). Sin savepoints.
 *
 * Contadores por DELTA: cada chunk suma solo las filas que pasaron pending→terminal
 * en ESA tx → sin doble conteo en recuperación (solo se procesan `pending`).
 */
@Injectable()
export class ImportProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportProcessor.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private readonly db: DbService,
    private readonly claims: ImportClaimRepository,
    private readonly animalWrite: AnimalWriteService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Un tick del poller: reclama y procesa un batch. Solo wiring — la conducta se prueba por processBatch. */
  async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const claimed = await this.claims.claimNext();
      if (claimed) await this.processBatch(claimed.id, claimed.tenantId);
    } catch (err) {
      // El chunk se revirtió; el batch queda en `processing` → se reintenta por heartbeat vencido.
      this.logger.warn(`Import fallo procesando; se reintentará por heartbeat: ${String(err)}`);
    } finally {
      this.draining = false;
    }
  }

  /** Procesa un batch ya reclamado (`processing`). Público para prueba determinista. */
  async processBatch(batchId: string, tenantId: string): Promise<void> {
    const meta = await this.withTenant(tenantId, null, (q) =>
      q.one<{ mapping: Mapping | null; total_rows: number; created_by: string | null }>(
        `SELECT mapping, total_rows, created_by FROM import_batches WHERE id = $1 AND tenant_id = $2`,
        [batchId, tenantId],
      ),
    );
    if (!meta) return;
    const mapping = (meta.mapping ?? {}) as Mapping;

    for (let lo = 0; lo < meta.total_rows; lo += CHUNK_SIZE) {
      const hi = Math.min(lo + CHUNK_SIZE, meta.total_rows);
      await this.processChunk(batchId, tenantId, meta.created_by, mapping, lo, hi);
    }

    // Link-pass (P-d.2): 2ª pasada de genealogía, solo si el mapping la referencia.
    if (mapping.dam_tag || mapping.sire_tag) {
      await this.withTenant(tenantId, meta.created_by, (q) =>
        q.query(`UPDATE import_batches SET phase = 'link', heartbeat_at = now() WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]),
      );
      for (let lo = 0; lo < meta.total_rows; lo += CHUNK_SIZE) {
        const hi = Math.min(lo + CHUNK_SIZE, meta.total_rows);
        await this.processLinkChunk(batchId, tenantId, meta.created_by, mapping, lo, hi);
      }
    }

    // Finalizar: solo se llega aquí si ningún chunk lanzó (todas las filas terminal).
    await this.withTenant(tenantId, meta.created_by, async (q) => {
      const c = await q.one<{ invalid_count: number; error_count: number }>(
        `SELECT invalid_count, error_count FROM import_batches WHERE id = $1 AND tenant_id = $2`,
        [batchId, tenantId],
      );
      const status = (c?.invalid_count ?? 0) > 0 || (c?.error_count ?? 0) > 0 ? 'completed_with_errors' : 'completed';
      await q.query(
        `UPDATE import_batches SET status = $3, phase = NULL, finished_at = now(), heartbeat_at = now(), updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [batchId, tenantId, status],
      );
    });
  }

  /** Un chunk (rango fijo de row_number) en UNA tx atómica. */
  private async processChunk(batchId: string, tenantId: string, createdBy: string | null, mapping: Mapping, lo: number, hi: number): Promise<void> {
    await this.withTenant(tenantId, createdBy, async (q) => {
      const rows = await q.query<{ id: string; row_number: number; raw: Record<string, string> }>(
        `SELECT id, row_number, raw FROM import_rows
         WHERE tenant_id = $1 AND batch_id = $2 AND row_number > $3 AND row_number <= $4 AND status = 'pending'
         ORDER BY row_number`,
        [tenantId, batchId, lo, hi],
      );
      if (!rows.length) {
        await q.query(`UPDATE import_batches SET heartbeat_at = now() WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]);
        return;
      }

      const syncOps: Op[] = [];
      let created = 0;
      let skipped = 0;
      let invalid = 0;

      for (const r of rows) {
        // Validación ESPERABLE antes de persistir (sin lanzar SQL).
        const nv = this.animalWrite.normalizeAndValidate(buildRawRow(r.raw, mapping));
        if (!nv.ok) {
          await this.markRow(q, tenantId, r.id, 'invalid', { errors: nv.errors });
          invalid++;
          continue;
        }
        const check = await this.animalWrite.checkAgainstDb(q, nv.input);
        if ('skip' in check) {
          await this.markRow(q, tenantId, r.id, 'skipped', { skipReason: check.skip });
          skipped++;
          continue;
        }
        if (!check.ok) {
          await this.markRow(q, tenantId, r.id, 'invalid', { errors: check.errors });
          invalid++;
          continue;
        }
        // Persistencia vía Herd (D1) + proyección server-origin (P-b).
        const { animalId, syncOp } = await this.animalWrite.persistNewAnimal(
          q,
          nv.input,
          { origin: 'import', actorUserId: createdBy ?? '', timeline: { eventType: 'animal_imported', source: 'import' }, sync: 'server_origin' },
          check.resolved,
        );
        if (syncOp) syncOps.push(syncOp);
        await this.markRow(q, tenantId, r.id, 'created', { resultingEntityId: animalId });
        created++;
      }

      // Un changeset server-origin por chunk — SOLO si hubo creaciones (nunca vacío).
      if (syncOps.length) {
        await this.animalWrite.emitServerOrigin(q, syncOps, `import:${batchId}:create:${lo}`);
      }

      // Contadores por DELTA (solo filas pending→terminal en esta tx) + heartbeat.
      await q.query(
        `UPDATE import_batches
           SET created_count = created_count + $3, skipped_count = skipped_count + $4,
               invalid_count = invalid_count + $5, heartbeat_at = now(), updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [batchId, tenantId, created, skipped, invalid],
      );
    });
  }

  /**
   * Link-pass de un chunk (P-d.2): vincula dam/sire de las filas `created` del rango,
   * en UNA tx. Resolución y detección de ciclos en LOTE (no N+1). Persiste solo los
   * warnings NO exitosos (el éxito lo representan dam_id/sire_id + el changeset) y
   * emite UN changeset server-origin del chunk SOLO si hubo cambios.
   */
  private async processLinkChunk(batchId: string, tenantId: string, createdBy: string | null, mapping: Mapping, lo: number, hi: number): Promise<void> {
    await this.withTenant(tenantId, createdBy, async (q) => {
      const rows = await q.query<{ id: string; raw: Record<string, string>; resulting_entity_id: string }>(
        `SELECT id, raw, resulting_entity_id FROM import_rows
         WHERE tenant_id = $1 AND batch_id = $2 AND row_number > $3 AND row_number <= $4 AND status = 'created' AND resulting_entity_id IS NOT NULL
         ORDER BY row_number`,
        [tenantId, batchId, lo, hi],
      );
      const damHeader = mapping.dam_tag;
      const sireHeader = mapping.sire_tag;
      const withRefs = rows
        .map((r) => ({
          row: r,
          damTag: damHeader ? r.raw[damHeader] : undefined,
          sireTag: sireHeader ? r.raw[sireHeader] : undefined,
        }))
        .filter((x) => (x.damTag && x.damTag !== '') || (x.sireTag && x.sireTag !== ''));

      if (!withRefs.length) {
        await q.query(`UPDATE import_batches SET heartbeat_at = now() WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]);
        return;
      }

      const allTags = withRefs.flatMap((x) => [x.damTag, x.sireTag]).filter((t): t is string => !!t);
      const genCtx = await this.animalWrite.loadGenealogyContext(q, allTags);

      // Candidatos para la detección de ciclos batch: solo resueltos + sexo-ok + no-self.
      const pairs: { childId: string; parentId: string }[] = [];
      for (const x of withRefs) {
        const child = x.row.resulting_entity_id;
        for (const [tag, expectSex] of [[x.damTag, 'F'], [x.sireTag, 'M']] as const) {
          if (!tag) continue;
          const res = genCtx.get(tag);
          if (res && res.sex === expectSex && res.animalId !== child) pairs.push({ childId: child, parentId: res.animalId });
        }
      }
      const cycles = await this.animalWrite.detectCycles(q, pairs);

      const syncOps: Op[] = [];
      for (const x of withRefs) {
        const { outcomes, damId, sireId } = this.animalWrite.evaluateLink(x.row.resulting_entity_id, { damTag: x.damTag, sireTag: x.sireTag }, genCtx, cycles);
        const { syncOp } = await this.animalWrite.applyGenealogyLink(q, x.row.resulting_entity_id, damId, sireId);
        if (syncOp) syncOps.push(syncOp);
        const warnings = outcomes.filter((o) => o.outcome !== 'linked');
        if (warnings.length) {
          await q.query(`UPDATE import_rows SET warnings = $3, processed_at = now() WHERE id = $1 AND tenant_id = $2`, [x.row.id, tenantId, JSON.stringify(warnings)]);
        }
      }

      if (syncOps.length) await this.animalWrite.emitServerOrigin(q, syncOps, `import:${batchId}:link:${lo}`);
      await q.query(`UPDATE import_batches SET heartbeat_at = now() WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]);
    });
  }

  private async markRow(
    q: Q,
    tenantId: string,
    rowId: string,
    status: 'created' | 'skipped' | 'invalid',
    extra: { errors?: unknown; skipReason?: string; resultingEntityId?: string },
  ): Promise<void> {
    // Transición EXCLUSIVA pending → terminal (guard `status='pending'`).
    await q.query(
      `UPDATE import_rows
         SET status = $3, errors = $4, skip_reason = $5, resulting_entity_id = $6, processed_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [rowId, tenantId, status, extra.errors ? JSON.stringify(extra.errors) : null, extra.skipReason ?? null, extra.resultingEntityId ?? null],
    );
  }

  /** Transacción tenant-scoped fuera del request (SET LOCAL app.tenant_id + requestContext). */
  private async withTenant<T>(tenantId: string, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return requestContext.run({ tenantId, userId: userId ?? '', role: 'system', q }, () => fn(q));
    });
  }
}
