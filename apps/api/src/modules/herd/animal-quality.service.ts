import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { assertAnimal } from './assert-animal';

/**
 * Calidad de datos del hato y genealogía (A360 E6).
 *
 * SEPARADO de `HerdService` por la misma razón que `LotsService`: es una vista de ANÁLISIS
 * sobre el hato, no la administración del animal. No escribe nada, no toca `AnimalWriteService`
 * ni `Billing`, y su única dependencia es la base — la costura ya estaba marcada en el archivo
 * original con su propio encabezado de sección.
 */
@Injectable()
export class AnimalQualityService {
  constructor(private readonly db: DbService) {}

  /**
   * Reporte de CALIDAD DE DATOS del hato (A360 E6): banderas de completitud y coherencia por animal
   * activo, agregadas por tipo de problema con muestra de animales. Una sola pasada SQL. NO duplica las
   * alertas reproductivas/sanitarias (esas viven en sus módulos); acá solo datos faltantes/incoherentes:
   * sin lote/caravana/ID oficial/foto/pesaje reciente/raza, genealogía incompleta y sexo/edad↔categoría.
   */
  async qualityReport(opts?: { noWeighingDays?: number }) {
    const t = this.db.tenant;
    const days = opts?.noWeighingDays ?? 120;
    const rows = await this.db.query<any>(
      `SELECT a.id, ai.value AS tag,
              (a.current_lot_id IS NULL) AS no_lot,
              (ai.value IS NULL) AS no_tag,
              (a.photo_file_id IS NULL) AS no_photo,
              NOT EXISTS (SELECT 1 FROM animal_identifiers o WHERE o.animal_id = a.id AND o.is_official = true AND o.deleted_at IS NULL AND o.retired_at IS NULL) AS no_official_id,
              (lw.weighed_at IS NULL OR lw.weighed_at < now() - ($2::int * INTERVAL '1 day')) AS no_recent_weighing,
              NOT EXISTS (SELECT 1 FROM animal_breeds ab WHERE ab.animal_id = a.id AND ab.deleted_at IS NULL) AS no_breed,
              (a.dam_id IS NULL AND a.sire_id IS NULL) AS incomplete_genealogy,
              (c.sex IS NOT NULL AND c.sex <> 'any' AND c.sex <> a.sex) AS sex_category_mismatch,
              (a.birth_date IS NOT NULL AND (
                 (c.min_age_months IS NOT NULL AND ((CURRENT_DATE - a.birth_date) / 30.44) < c.min_age_months) OR
                 (c.max_age_months IS NOT NULL AND ((CURRENT_DATE - a.birth_date) / 30.44) > c.max_age_months)
              )) AS age_category_mismatch
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN LATERAL (SELECT weighed_at FROM v_weighings w WHERE w.animal_id = a.id AND w.deleted_at IS NULL ORDER BY weighed_at DESC, created_at DESC, id DESC LIMIT 1) lw ON true
       WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL`,
      [t, days],
    );

    const DEFS: { code: string; label: string; filter?: string }[] = [
      { code: 'no_lot', label: 'Sin lote asignado', filter: 'with_lot=false' },
      { code: 'no_tag', label: 'Sin caravana visual' },
      { code: 'no_official_id', label: 'Sin identificador oficial', filter: 'with_official_id=false' },
      { code: 'no_photo', label: 'Sin foto', filter: 'with_photo=false' },
      { code: 'no_recent_weighing', label: `Sin pesaje en ${days} días`, filter: `no_recent_weighing=${days}` },
      { code: 'no_breed', label: 'Sin raza cargada' },
      { code: 'incomplete_genealogy', label: 'Genealogía incompleta (sin padres)' },
      { code: 'sex_category_mismatch', label: 'Sexo incoherente con la categoría' },
      { code: 'age_category_mismatch', label: 'Edad fuera del rango de la categoría' },
    ];

    const issues = DEFS.map((d) => {
      const hits = rows.filter((r) => r[d.code]);
      return {
        code: d.code,
        label: d.label,
        filter: d.filter ?? null,
        count: hits.length,
        animals: hits.slice(0, 50).map((r) => ({ id: r.id, tag: r.tag ?? null })),
      };
    });

    return { total: rows.length, issues };
  }

  /**
   * Genealogía extendida (A360 E6): ancestros hasta `depth` generaciones (madre/padre recursivo) +
   * descendencia directa. Para el árbol de la ficha. CTE recursiva acotada (defensa de profundidad).
   */
  async animalGenealogy(id: string, depth = 3) {
    await assertAnimal(this.db, id);
    const t = this.db.tenant;
    const d = Math.min(Math.max(depth, 1), 4);
    const ancestors = await this.db.query<any>(
      `WITH RECURSIVE anc(id, relation, generation, path) AS (
         -- Término base ÚNICO: padres directos (madre y padre) vía VALUES lateral.
         SELECT parent.pid, parent.rel::text, 1, ARRAY[a.id, parent.pid]
         FROM animals a
         CROSS JOIN LATERAL (VALUES (a.dam_id, 'dam'), (a.sire_id, 'sire')) AS parent(pid, rel)
         WHERE a.id = $1 AND parent.pid IS NOT NULL
         UNION ALL
         -- Término recursivo ÚNICO: padres de cada ancestro.
         SELECT gp.pid, anc.relation || '.' || gp.rel, anc.generation + 1, anc.path || gp.pid
         FROM anc JOIN animals p ON p.id = anc.id
         CROSS JOIN LATERAL (VALUES (p.dam_id, 'dam'), (p.sire_id, 'sire')) AS gp(pid, rel)
         WHERE gp.pid IS NOT NULL AND anc.generation < $3 AND NOT (gp.pid = ANY(anc.path))
       )
       SELECT anc.id, anc.relation, anc.generation, a.sex, ai.value AS tag, a.name, a.status
       FROM anc JOIN animals a ON a.id = anc.id AND a.tenant_id = $2
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       ORDER BY anc.generation, anc.relation`,
      [id, t, d],
    );
    const offspring = await this.db.query<any>(
      `SELECT a.id, ai.value AS tag, a.sex, a.birth_date, a.status,
              (a.dam_id = $1) AS via_dam
       FROM animals a
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE (a.dam_id = $1 OR a.sire_id = $1) AND a.tenant_id = $2 AND a.deleted_at IS NULL
       ORDER BY a.birth_date DESC NULLS LAST`,
      [id, t],
    );
    return { ancestors, offspring };
  }
}
