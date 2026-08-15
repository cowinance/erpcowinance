import { NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Valida que el animal exista en el tenant y no esté dado de baja; si no, 404.
 *
 * Es una función suelta y no un método porque la necesitan TRES servicios del módulo
 * (`HerdService`, `AnimalIdentifiersService`, `AnimalQualityService`) y ninguno debería
 * depender de otro solo para esto. Duplicarla sería peor: la condición de "animal válido"
 * —tenant + no borrado— tiene que ser una sola en todo el módulo.
 */
export async function assertAnimal(db: DbService, id: string): Promise<void> {
  const found = await db.one(`SELECT id FROM animals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [
    id,
    db.tenant,
  ]);
  if (!found) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
}
