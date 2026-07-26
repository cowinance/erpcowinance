import { Injectable } from '@nestjs/common';
import { adjustWeaningWeight, sireIndexes, type AnimalSex, type ContemporaryMember } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Evaluación de toros: de la pajuela al kilo (Fase 2.3).
 *
 * Hasta acá Genética era un DEPÓSITO — sabía qué pajuela había, en qué termo y cuánto nitrógeno
 * quedaba, pero nunca se unía con el desempeño de los animales. Contestaba «¿qué tengo?» y no la
 * pregunta que cuesta plata: **¿qué semen vuelvo a comprar?**
 *
 * La cadena ya existía entera en el esquema y nadie la recorría:
 *
 *   semen_batches → breeding_events → pregnancies → calvings → calving_offspring
 *                 → animals (sire_id) → weanings → v_weighings
 *
 * Se entra por `animals.sire_id`, que es el padre EFECTIVO del ternero, y no por el evento
 * reproductivo. Motivo: un servicio puede no haber preñado, una preñez puede perderse, y lo que
 * hay que evaluar es el ternero que efectivamente nació. Ir por el evento contaría intenciones.
 */
@Injectable()
export class SireEvaluationService {
  constructor(private readonly db: DbService) {}

  /**
   * Evaluación por toro dentro de un grupo contemporáneo.
   *
   * El grupo por defecto es el AÑO DE NACIMIENTO: los terneros de una misma parición comparten
   * clima, pasto y manejo. Comparar contra otro año le atribuiría a la genética lo que fue la
   * lluvia. Es la agrupación más gruesa que sigue siendo honesta; afinarla por lote es el paso
   * siguiente cuando haya volumen para sostenerlo.
   */
  async bySire(params: { year?: number } = {}) {
    const t = this.db.tenant;

    const crias = await this.db.query<any>(
      `SELECT a.id, a.sex, a.birth_date,
              a.sire_id,
              COALESCE(sa.name, si.value, 'Sin identificar') AS sire_name,
              w.weaning_weight_kg::float AS weaning_kg,
              w.weaning_date,
              (w.weaning_date::date - a.birth_date::date)::int AS edad_destete_dias,
              co.birth_weight_kg::float AS birth_kg,
              -- Edad de la madre AL PARIR, no hoy: el ajuste corrige la leche que dio entonces.
              CASE WHEN dam.birth_date IS NOT NULL
                   THEN EXTRACT(YEAR FROM age(a.birth_date::date, dam.birth_date::date))::int END AS dam_age_years,
              EXTRACT(YEAR FROM a.birth_date::date)::int AS anio
         FROM animals a
         JOIN weanings w ON w.animal_id = a.id AND w.deleted_at IS NULL AND w.weaning_weight_kg IS NOT NULL
         LEFT JOIN animals sa ON sa.id = a.sire_id AND sa.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = a.sire_id AND x.type = 'visual' AND x.deleted_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) si ON true
         LEFT JOIN animals dam ON dam.id = a.dam_id AND dam.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT birth_weight_kg FROM calving_offspring c
            WHERE c.animal_id = a.id AND c.deleted_at IS NULL LIMIT 1) co ON true
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.sire_id IS NOT NULL
          AND a.birth_date IS NOT NULL AND w.weaning_date IS NOT NULL`,
      [t],
    );

    // Un destete con edad no positiva es un dato mal cargado (fecha anterior al nacimiento). Se
    // descarta y se CUENTA, en vez de dejarlo romper el promedio en silencio.
    const utilizables = crias.filter((c) => Number(c.edad_destete_dias) > 0 && Number(c.weaning_kg) > 0);
    const descartadas = crias.length - utilizables.length;

    const anios = [...new Set(utilizables.map((c) => c.anio))].sort((a, b) => b - a);
    const anio = params.year ?? anios[0];
    const grupo = utilizables.filter((c) => c.anio === anio);

    const nombres = new Map<string, string>();
    let incompletas = 0;
    const miembros: ContemporaryMember[] = [];
    for (const c of grupo) {
      const aj = adjustWeaningWeight({
        weaningWeightKg: Number(c.weaning_kg),
        birthWeightKg: c.birth_kg ?? null,
        ageAtWeaningDays: Number(c.edad_destete_dias),
        sex: c.sex as AnimalSex,
        damAgeYears: c.dam_age_years ?? null,
      });
      if (!aj.complete) incompletas++;
      nombres.set(c.sire_id, c.sire_name);
      miembros.push({ sireId: c.sire_id, adjustedKg: aj.adjustedKg });
    }

    return {
      // El año evaluado y los disponibles: sin esto, el usuario no sabe QUÉ está mirando.
      year: anio ?? null,
      available_years: anios,
      group_size: grupo.length,
      /** Terneros a los que les faltó peso de nacimiento o edad de madre: el índice los incluye pero son menos comparables. */
      incomplete: incompletas,
      /** Destetes con datos imposibles, descartados. Se informa en vez de esconderse. */
      discarded: descartadas,
      sires: sireIndexes(miembros).map((s) => ({ ...s, sire_name: nombres.get(s.sireId) ?? 'Sin identificar' })),
    };
  }
}
