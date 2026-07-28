import { Injectable } from '@nestjs/common';
import {
  INBREEDING_BLOCK_THRESHOLD,
  animalInbreeding,
  describeInbreeding,
  inbreedingLevel,
  matingInbreeding,
  type InbreedingLevel,
  type Pedigree,
  type PedigreeNode,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Consanguinidad de un apareamiento, sobre el pedigrí real de la finca.
 *
 * La REGLA (el coeficiente de Wright) vive en el dominio; acá solo se trae el pedigrí y se le pasa.
 * Esa separación no es ceremonia: el cálculo se puede probar con parentescos conocidos —padre×hija
 * 25%, abuelo×nieta 12,5%— sin base de datos, que es la única forma de saber que está bien.
 *
 * **Cuántas generaciones.** Seis. No es un número redondo elegido al azar: el aporte de un ancestro
 * se divide por dos en cada generación, así que a la sexta un antepasado suma como máximo 1,6% y
 * cae dentro del ruido de un pedigrí de finca, donde además faltan datos. Traer más generaciones
 * costaría más consulta para cambiar decimales que nadie va a mirar.
 */
export interface MatingInbreeding {
  /** Coeficiente F de la cría, en fracción (0,125 = 12,5%). */
  f: number;
  /** El mismo número en porcentaje, ya redondeado para mostrar. */
  f_pct: number;
  level: InbreedingLevel;
  /** Qué parentesco es, en castellano. Un número solo no le dice nada a nadie. */
  description: string;
  /** `true` si supera el umbral: el servicio se bloquea salvo que se fuerce. */
  blocks: boolean;
  /** Cuántos animales del pedigrí se pudieron cargar. Con pocos, el número vale menos. */
  pedigree_size: number;
}

/** Generaciones hacia atrás que se cargan. Ver el porqué en el comentario de la clase. */
const GENERATIONS = 6;

@Injectable()
export class InbreedingService {
  constructor(private readonly db: DbService) {}

  /**
   * Ancestros de un conjunto de animales, hasta `GENERATIONS` generaciones.
   *
   * Una sola consulta recursiva en vez de ir subiendo de a un nivel: el pedigrí de dos animales a
   * seis generaciones son hasta 126 filas, y pedirlas de a una serían 126 consultas para contestar
   * si conviene servir una vaca.
   *
   * `UNION` y no `UNION ALL` a propósito: además de no repetir a un ancestro que aparece por las
   * dos ramas —lo normal en un rodeo cerrado—, corta la recursión si el pedigrí tiene un ciclo por
   * una carga mal hecha.
   */
  async pedigreeFor(ids: string[], generations = GENERATIONS): Promise<Pedigree> {
    const limpios = ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
    const ped = new Map<string, PedigreeNode>();
    if (!limpios.length) return ped;

    const filas = await this.db.query<{ id: string; sire_id: string | null; dam_id: string | null }>(
      `WITH RECURSIVE ped AS (
         SELECT a.id, a.sire_id, a.dam_id, 0 AS gen
           FROM animals a
          WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.id = ANY($2::uuid[])
         UNION
         SELECT p.id, p.sire_id, p.dam_id, ped.gen + 1
           FROM ped
           JOIN animals p ON p.tenant_id = $1 AND p.deleted_at IS NULL AND p.id IN (ped.sire_id, ped.dam_id)
          WHERE ped.gen < $3
       )
       SELECT id, sire_id, dam_id FROM ped`,
      [this.db.tenant, limpios, generations],
    );

    for (const f of filas) ped.set(f.id, { sireId: f.sire_id, damId: f.dam_id });
    return ped;
  }

  /** F de la cría que saldría de aparear a estos dos, con todo lo que la pantalla necesita mostrar. */
  async forMating(sireId: string, damId: string, umbral: number = INBREEDING_BLOCK_THRESHOLD): Promise<MatingInbreeding> {
    const ped = await this.pedigreeFor([sireId, damId]);
    const f = matingInbreeding(sireId, damId, ped);
    return {
      f,
      f_pct: Math.round(f * 1000) / 10,
      level: inbreedingLevel(f, umbral),
      description: describeInbreeding(f),
      blocks: f >= umbral,
      pedigree_size: ped.size,
    };
  }

  /** F de un animal que ya existe: cuán consanguíneo es él mismo. */
  async forAnimal(animalId: string): Promise<{ f: number; f_pct: number; level: InbreedingLevel; description: string }> {
    const ped = await this.pedigreeFor([animalId]);
    const f = animalInbreeding(animalId, ped);
    return { f, f_pct: Math.round(f * 1000) / 10, level: inbreedingLevel(f), description: describeInbreeding(f) };
  }

  /**
   * Los toros disponibles, ordenados por cuán poco emparentados están con esta vaca.
   *
   * Es el vuelco que faltaba: hasta ahora el sistema solo sabía decir «no» DESPUÉS de que el
   * productor eligiera mal. Preguntar «¿con cuál sí?» es la forma en que se toma la decisión en el
   * corral, y el dato para contestarlo ya estaba en la base.
   */
  async advisorFor(damId: string, umbral: number = INBREEDING_BLOCK_THRESHOLD) {
    const toros = await this.db.query<{ id: string; name: string | null; tag: string | null }>(
      `SELECT a.id, a.name, ai.value AS tag
         FROM animals a
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = a.id AND x.type = 'visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) ai ON true
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.sex = 'M' AND a.status = 'active'`,
      [this.db.tenant],
    );
    if (!toros.length) return { dam_id: damId, sires: [] };

    // UN solo pedigrí para todos los candidatos: pedir uno por toro haría N consultas recursivas
    // para responder una pregunta.
    const ped = await this.pedigreeFor([damId, ...toros.map((t) => t.id)]);

    return {
      dam_id: damId,
      sires: toros
        .map((t) => {
          const f = matingInbreeding(t.id, damId, ped);
          return {
            sire_id: t.id,
            sire_name: t.name ?? t.tag ?? 'Sin identificar',
            tag: t.tag,
            f,
            f_pct: Math.round(f * 1000) / 10,
            level: inbreedingLevel(f, umbral),
            blocks: f >= umbral,
          };
        })
        .sort((a, b) => a.f - b.f),
    };
  }
}
