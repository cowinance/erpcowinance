import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidCatalogEntryError, validateBreedInput, validateDiagnosisInput } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Catálogos maestros (A3 · Configuración) — el "customizing" del ERP. Distingue catálogos GLOBALES de
 * solo lectura (species, animal_categories, units: sin tenant_id, compartidos por todos) de los que
 * admiten EXTENSIÓN POR TENANT (breeds, diagnoses: tenant_id nullable → NULL es la base global y cada
 * tenant agrega/borra los suyos). Como estas tablas no tienen RLS, el scoping `tenant_id IS NULL OR =
 * tenant` se aplica acá; un tenant nunca ve ni toca las entradas propias de otro ni las globales.
 */
@Injectable()
export class CatalogsService {
  constructor(private readonly db: DbService) {}

  async catalogs() {
    const t = this.db.tenant;
    const [species, breeds, categories, units, diagnoses] = await Promise.all([
      this.db.query(`SELECT id, code, name, gestation_days FROM species WHERE deleted_at IS NULL ORDER BY name`),
      this.db.query(
        `SELECT b.id, b.code, b.name, b.purpose, b.species_id, s.name AS species_name, (b.tenant_id IS NOT NULL) AS editable
         FROM breeds b JOIN species s ON s.id = b.species_id
         WHERE b.deleted_at IS NULL AND (b.tenant_id IS NULL OR b.tenant_id = $1) ORDER BY s.name, b.name`,
        [t],
      ),
      this.db.query(`SELECT id, code, name, sex, min_age_months, max_age_months, species_id FROM animal_categories WHERE deleted_at IS NULL ORDER BY name`),
      this.db.query(`SELECT code, name, dimension, si_factor::float AS si_factor FROM units ORDER BY dimension, name`),
      this.db.query(
        `SELECT id, code, name, category, is_notifiable, (tenant_id IS NOT NULL) AS editable
         FROM diagnoses WHERE deleted_at IS NULL AND (tenant_id IS NULL OR tenant_id = $1) ORDER BY name`,
        [t],
      ),
    ]);
    return { species, breeds, categories, units, diagnoses };
  }

  async createBreed(body: { species_id?: string; code?: unknown; name?: unknown; purpose?: unknown }) {
    const t = this.db.tenant;
    if (!body?.species_id) throw new BadRequestException({ code: 'config.breed_species_required', title: 'species_id es obligatorio' });
    const species = await this.db.one<{ id: string }>(`SELECT id FROM species WHERE id=$1 AND deleted_at IS NULL`, [body.species_id]);
    if (!species) throw new BadRequestException({ code: 'config.species_not_found', title: 'La especie no existe' });
    const input = this.validate(() => validateBreedInput(body));
    try {
      const [row] = await this.db.query(
        `INSERT INTO breeds (tenant_id, species_id, code, name, purpose) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, code, name, purpose, species_id, true AS editable`,
        [t, body.species_id, input.code, input.name, input.purpose],
      );
      return row;
    } catch (e) {
      throw this.mapUnique(e, 'config.breed_duplicate', 'Ya existe una raza con ese código para la especie');
    }
  }

  async deleteBreed(id: string) {
    // Solo las razas propias del tenant se borran; las globales (tenant_id NULL) y las de otro tenant no.
    const res = await this.db.query(
      `UPDATE breeds SET deleted_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (res.length === 0) throw new NotFoundException({ code: 'config.breed_not_deletable', title: 'La raza no existe o es del catálogo base (no editable)' });
    return { id, deleted: true };
  }

  async createDiagnosis(body: { code?: unknown; name?: unknown; category?: unknown; is_notifiable?: unknown }) {
    const input = this.validate(() => validateDiagnosisInput(body));
    try {
      const [row] = await this.db.query(
        `INSERT INTO diagnoses (tenant_id, code, name, category, is_notifiable) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, code, name, category, is_notifiable, true AS editable`,
        [this.db.tenant, input.code, input.name, input.category, input.isNotifiable],
      );
      return row;
    } catch (e) {
      throw this.mapUnique(e, 'config.diagnosis_duplicate', 'Ya existe un diagnóstico con ese código');
    }
  }

  async deleteDiagnosis(id: string) {
    const res = await this.db.query(
      `UPDATE diagnoses SET deleted_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, this.db.tenant],
    );
    if (res.length === 0) throw new NotFoundException({ code: 'config.diagnosis_not_deletable', title: 'El diagnóstico no existe o es del catálogo base (no editable)' });
    return { id, deleted: true };
  }

  /** Ejecuta una validación de dominio y traduce su error a 400. */
  private validate<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidCatalogEntryError) throw new BadRequestException({ code: 'config.invalid_entry', title: e.reason });
      throw e;
    }
  }

  private mapUnique(e: unknown, code: string, title: string): Error {
    if ((e as { code?: string })?.code === '23505') return new ConflictException({ code, title });
    return e as Error;
  }
}
