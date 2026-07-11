import { Injectable } from '@nestjs/common';
import type { Op } from '@cowinance/sync-core';
import { DbService, Q } from '../../../db/db.service';

/**
 * Emisor de changesets de ORIGEN SERVIDOR (ADR-0016). Escribe una fila
 * `sync_changesets` con `source='server'`, `sync_device_id`/`seq` NULL e
 * idempotencia por `(tenant_id, origin_ref)` — la vía de propagación incremental
 * por pull de entidades creadas server-side (alta web ahora; procesador de import
 * en P-c). Infraestructura de sync, `@Global` vía SyncRegistryModule (como
 * SyncVersionStore/SyncConflictWriter); cualquier módulo la inyecta sin acoplarse.
 *
 * NO escribe `sync_conflicts` (es una creación, no un conflicto). `server_seq` lo
 * asigna el DEFAULT (secuencia global) → orden del servidor. `operations` con el
 * mismo shape que consume el pull: `{ client_id, schema_version, ops }`.
 */
@Injectable()
export class ServerOriginChangesetWriter {
  constructor(private readonly db: DbService) {}

  /** Emite un changeset server-origin con `ops`, deduplicado por `originRef`. No-op si ya existe. */
  async emit(q: Q, ops: Op[], originRef: string): Promise<void> {
    if (!ops.length) return;
    const hlc = ops[ops.length - 1].hlc; // hlc del changeset (informativo; el pull ordena por server_seq)
    const operations = JSON.stringify({ client_id: originRef, schema_version: 1, ops });
    await q.query(
      `INSERT INTO sync_changesets (tenant_id, source, origin_ref, hlc, operations, status, received_at, applied_at)
       VALUES ($1, 'server', $2, $3, $4, 'applied', now(), now())
       ON CONFLICT (tenant_id, origin_ref) WHERE source = 'server' DO NOTHING`,
      [this.db.tenant, originRef, hlc, operations],
    );
  }
}
