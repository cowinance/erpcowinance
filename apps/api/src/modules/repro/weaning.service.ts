import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

/**
 * Núcleo NEUTRAL de destete (P5-1.c). Regla y escritura ÚNICAS del destete,
 * reutilizadas por REST/web y sync entrante. Cada canal aporta CONTEXTO explícito
 * (`origin`, `weaningId`, `hlc` cuando proceda); el cuerpo no ramifica por canal.
 *
 * El destete es un HECHO PRODUCTIVO: NO modifica ningún campo autoritativo del animal,
 * por lo que NO lleva `put` ni changeset server-origin (a diferencia de mortalidad). El
 * hecho y su pesaje viajan como intención event-only y se materializan en el servidor.
 *
 * En una sola transacción produce: (1) UNA fila `weanings`; (2) si hay peso, el PESAJE
 * asociado — dato propio del evento de destete, no una coincidencia temporal con un
 * pesaje genérico; (3) UN evento `weaning` de timeline. Si cualquier efecto falla, no
 * queda un destete parcial (la tx revierte).
 *
 * Idempotencia por `weaningId` (id de la fila `weanings`): un guard temprano evita
 * reprocesar. Además el pesaje asociado tiene IDENTIDAD DETERMINISTA derivada del
 * `weaningId` (mismo uuid en `weighings`, `ON CONFLICT (id) DO NOTHING`) → reprocesar el
 * mismo evento nunca crea otro destete, otro pesaje ni otro evento de timeline.
 */

export type WeaningOrigin = 'rest' | 'sync';

export interface RecordWeaningInput {
  animalId: string;
  weaningDate?: string;
  weightKg?: number | null;
  /** Clave de idempotencia = id de la fila `weanings` (uuid en REST, op id en sync). */
  weaningId: string;
  actorUserId: string;
  origin: WeaningOrigin;
  /** Permitido por simetría; hoy no se usa: el destete no escribe LWW (sin campo autoritativo). */
  hlc?: string;
}

export interface RecordWeaningResult {
  recorded: boolean;
  /** true si `weaningId` ya estaba registrado → no-op idempotente. */
  alreadyRecorded: boolean;
  weaningId: string;
  weaningDate: string;
  weightKg: number | null;
  tag: string | null;
}

@Injectable()
export class WeaningService {
  constructor(private readonly db: DbService) {}

  /**
   * Registra el destete de UN animal, atómico e idempotente por `weaningId`. Si hay peso,
   * la MISMA tx crea el pesaje asociado (identidad determinista). Rechaza (sin escritura)
   * si el animal no existe.
   */
  async recordWeaning(q: Q, input: RecordWeaningInput): Promise<RecordWeaningResult> {
    const t = this.db.tenant;

    // Idempotencia: la misma operación (mismo id) ya registrada → no-op total.
    const existing = await q.one<{ id: string; weaning_date: string; weaning_weight_kg: number | null }>(
      `SELECT id, weaning_date, weaning_weight_kg FROM weanings WHERE id = $1 AND tenant_id = $2`,
      [input.weaningId, t],
    );
    if (existing) {
      return {
        recorded: false,
        alreadyRecorded: true,
        weaningId: input.weaningId,
        weaningDate: existing.weaning_date,
        weightKg: existing.weaning_weight_kg,
        tag: null,
      };
    }

    const animal = await q.one<{ id: string; dam_id: string | null; tag: string | null }>(
      `SELECT a.id, a.dam_id, ai.value AS tag
       FROM animals a
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x
         WHERE x.animal_id = a.id AND x.type = 'visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [input.animalId, t],
    );
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });

    const weaningDate = (input.weaningDate ?? new Date().toISOString()).slice(0, 10);
    const weightKg = input.weightKg ?? null;

    // (1) hecho: fila weanings con id determinista = weaningId.
    await q.query(
      `INSERT INTO weanings (id, tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [input.weaningId, t, input.animalId, weaningDate, weightKg, animal.dam_id, input.actorUserId],
    );

    // (2) pesaje asociado (si hay peso), con identidad determinista derivada del weaningId.
    if (weightKg != null) {
      await q.query(
        `INSERT INTO weighings (id, tenant_id, animal_id, weighed_at, weight_kg, method, created_by)
         VALUES ($1,$2,$3,$4,$5,'scale',$6)
         ON CONFLICT (id) DO NOTHING`,
        [input.weaningId, t, input.animalId, weaningDate, weightKg, input.actorUserId],
      );
    }

    // (3) timeline: un evento weaning.
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,'weaning',$3,$4,now(),'manual')`,
      [t, input.animalId, JSON.stringify({ weight_kg: weightKg, origin: input.origin }), weaningDate],
    );

    return { recorded: true, alreadyRecorded: false, weaningId: input.weaningId, weaningDate, weightKg, tag: animal.tag };
  }
}
