import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Genética — evaluaciones (G-2b): `genetic_evaluations` por animal (traits jsonb: EPDs/DEPs, índices).
 * Todo por tenant; baja lógica por `deleted_at`.
 */
@Injectable()
export class EvaluationsService {
  constructor(private readonly db: DbService) {}

  async list(animalId?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (animalId) {
      params.push(animalId);
      filter = ` AND animal_id = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, animal_id, source, evaluation_date, traits, lab_sample_id FROM genetic_evaluations
       WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY evaluation_date DESC NULLS LAST, created_at DESC LIMIT 200`,
      params,
    );
  }

  async create(body: any) {
    const animalId = body?.animal_id;
    if (!animalId) throw new BadRequestException({ code: 'genetics.missing_animal', title: 'animal_id es obligatorio' });
    const animal = await this.db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [animalId, this.db.tenant]);
    if (!animal) throw new NotFoundException({ code: 'genetics.animal_not_found', title: 'Animal no encontrado' });
    const traits = body?.traits ?? {};
    if (typeof traits !== 'object' || Array.isArray(traits)) throw new BadRequestException({ code: 'genetics.invalid_traits', title: 'traits debe ser un objeto' });
    return this.db.one(
      `INSERT INTO genetic_evaluations (tenant_id, animal_id, source, evaluation_date, traits, lab_sample_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, animal_id, source, evaluation_date, traits, lab_sample_id`,
      [this.db.tenant, animalId, body?.source ?? null, body?.evaluation_date ?? null, JSON.stringify(traits), body?.lab_sample_id ?? null, this.db.user],
    );
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE genetic_evaluations SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'genetics.evaluation_not_found', title: 'Evaluación no encontrada' });
    return { id, deleted: true };
  }
}
