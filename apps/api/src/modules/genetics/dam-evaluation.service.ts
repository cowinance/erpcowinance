import { Injectable } from '@nestjs/common';
import { cullCandidates, damProductivity, type DamRecord } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Evaluación de vientres: con qué vacas quedarse.
 *
 * La mitad de la genética de cada ternero viene de la madre, y hasta acá ninguna vaca se evaluaba
 * individualmente — `dam_id` solo entraba como *ajuste* del peso al destete de sus crías. Eso deja
 * afuera la decisión más frecuente de una finca de cría: qué vientres retener y cuáles descartar.
 *
 * La REGLA vive en el dominio (`damProductivity`, `cullCandidates`). Acá solo se arma el historial
 * de cada vaca: cuándo empezó a producir, qué destetó y si todavía está.
 */
@Injectable()
export class DamEvaluationService {
  constructor(private readonly db: DbService) {}

  /**
   * Kilos destetados por vaca y por año, con las candidatas a descarte.
   *
   * Una sola consulta agrupada: pedirle a la base el historial vaca por vaca serían tantas
   * consultas como vientres tenga la finca para dibujar una tabla.
   *
   * La fecha de salida sale del estado del animal, no de una columna de baja: un animal `sold`,
   * `dead` o `culled` dejó de producir, y seguir contándole años lo haría ver cada vez peor sin que
   * pueda hacer nada — el ranking histórico cambiaría solo con el paso del tiempo.
   */
  async byDam() {
    const t = this.db.tenant;

    const filas = await this.db.query<{
      dam_id: string;
      dam_name: string | null;
      tag: string | null;
      first_calving: string;
      exit_date: string | null;
      weanings: { date: string; kg: number }[] | null;
    }>(
      `SELECT d.id AS dam_id,
              d.name AS dam_name,
              ai.value AS tag,
              min(c.calving_date)::text AS first_calving,
              -- Salió del rodeo: hasta ahí se la cuenta.
              CASE WHEN d.status <> 'active' THEN d.status_changed_at::date::text END AS exit_date,
              (SELECT COALESCE(json_agg(json_build_object('date', w.weaning_date::text, 'kg', w.weaning_weight_kg::float)), '[]'::json)
                 FROM weanings w
                WHERE w.dam_id = d.id AND w.tenant_id = d.tenant_id AND w.deleted_at IS NULL
                  AND w.weaning_weight_kg IS NOT NULL) AS weanings
         FROM animals d
         JOIN calvings c ON c.dam_id = d.id AND c.tenant_id = d.tenant_id AND c.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = d.id AND x.type = 'visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) ai ON true
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.sex = 'F'
        GROUP BY d.id, d.name, ai.value, d.status, d.status_changed_at`,
      [t],
    );

    const nombres = new Map(filas.map((f) => [f.dam_id, f.dam_name ?? f.tag ?? 'Sin identificar']));
    const registros: DamRecord[] = filas.map((f) => ({
      damId: f.dam_id,
      firstCalvingDate: f.first_calving,
      exitDate: f.exit_date,
      weanings: f.weanings ?? [],
    }));

    const hoy = await this.db.today();
    const dams = damProductivity(registros, hoy);
    const conNombre = dams.map((d) => ({ ...d, dam_name: nombres.get(d.damId) ?? 'Sin identificar' }));
    const descarte = new Set(cullCandidates(dams).map((d) => d.damId));

    return {
      as_of: hoy,
      total: conNombre.length,
      /** Vientres por debajo del rodeo: sugerencia, no orden. La decisión sigue siendo del productor. */
      cull_candidates: conNombre.filter((d) => descarte.has(d.damId)),
      dams: conNombre,
    };
  }
}
