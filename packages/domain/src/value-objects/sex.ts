import type { Brand } from '../shared/brand';
import { DomainError } from '../shared/domain-error';

/**
 * Sex — el sexo del animal. Garantías que aporta como Value Object:
 *  - validación: conjunto cerrado {F, M} (hoy fragmentada entre el CHECK de
 *    Postgres, uniones de TypeScript sueltas y formularios sin validar);
 *  - type-safety: reemplaza las uniones `'F' | 'M'` repetidas sin una
 *    frontera de dominio única;
 *  - comportamiento: `isFemale`/`isMale`, lenguaje ubicuo del dominio.
 *
 * Alcance deliberado: SOLO crear, validar, comparar y consultar semántica
 * básica. No modela capacidad reproductiva, elegibilidad para servicio ni
 * gestación — esas son reglas de dominio de nivel superior (servicios de
 * `health`/`reproduction`, F4), no responsabilidad de este VO.
 *
 * Nota: distinto de `animal_categories.sex`, que además admite `'any'`
 * (compatibilidad categoría↔sexo). Ese es un concepto separado; este VO
 * modela únicamente el sexo real de un animal.
 */

export type Sex = Brand<'F' | 'M', 'Sex'>;

export class InvalidSex extends DomainError {
  readonly code = 'domain.invalid_sex';
  constructor(readonly value: unknown) {
    super(`Sexo inválido: se esperaba 'F' o 'M'`);
  }
}

export const Sex = {
  /** Construye el sexo; lanza InvalidSex si no es 'F' ni 'M'. */
  of(raw: unknown): Sex {
    if (raw !== 'F' && raw !== 'M') throw new InvalidSex(raw);
    return raw as Sex;
  },
  /** ¿`of()` tendría éxito con este valor? */
  isValid(raw: unknown): raw is Sex {
    return raw === 'F' || raw === 'M';
  },
  equals(a: Sex, b: Sex): boolean {
    return a === b;
  },
  isFemale(sex: Sex): boolean {
    return sex === 'F';
  },
  isMale(sex: Sex): boolean {
    return sex === 'M';
  },
};
