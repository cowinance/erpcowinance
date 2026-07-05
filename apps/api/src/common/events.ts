import { DbService } from '../db/db.service';

/** Inserta un hecho inmutable en el event store del animal (línea de tiempo). */
export async function insertAnimalEvent(
  db: DbService,
  animalId: string,
  type: string,
  payload: Record<string, unknown>,
  occurredAt?: string,
) {
  return db.one<any>(
    `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
     VALUES ($1,$2,$3,$4,$5,now(),'manual') RETURNING id, event_type, occurred_at`,
    [db.tenant, animalId, type, JSON.stringify(payload), occurredAt ?? new Date().toISOString()],
  );
}

/** Valida que el animal exista en el tenant y lo devuelve con su caravana. */
export async function requireAnimal(db: DbService, animalId: string) {
  const row = await db.one<any>(
    `SELECT a.id, a.sex, a.status, ai.value AS tag
     FROM animals a
     LEFT JOIN LATERAL (
       SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type = 'visual' AND x.deleted_at IS NULL
       ORDER BY x.created_at DESC LIMIT 1) ai ON true
     WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
    [animalId, db.tenant],
  );
  return row;
}
