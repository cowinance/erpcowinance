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

/**
 * Cómo lo escribe el productor → cómo lo guarda el sistema.
 *
 * El sexo se ALMACENA como {F,M}, que es la convención inglesa (female/male). Pero en castellano
 * la notación de campo es **H de hembra y M de macho**, y es la que sale de cualquier planilla
 * hecha en la finca. Aceptar solo `F` rechazaba exactamente la mitad de cada importación —todas
 * las hembras— con un error por fila que obligaba a buscar y reemplazar en el Excel.
 *
 * `M` significa macho y male: misma letra, mismo sexo, sin ambigüedad. Se acepta también la
 * palabra entera, que es lo que escribe quien no usa abreviaturas.
 *
 * A propósito NO se aceptan categorías (`vaca`, `toro`, `novillo`): son otro campo, y adivinar el
 * sexo desde ahí taparía una columna mal mapeada en vez de señalarla.
 */
const ESCRITURAS: Record<string, 'F' | 'M'> = {
  f: 'F',
  h: 'F',
  hembra: 'F',
  female: 'F',
  m: 'M',
  macho: 'M',
  male: 'M',
};

export const Sex = {
  /** Construye el sexo; lanza InvalidSex si no es 'F' ni 'M'. */
  of(raw: unknown): Sex {
    if (raw !== 'F' && raw !== 'M') throw new InvalidSex(raw);
    return raw as Sex;
  },

  /**
   * Interpreta cómo viene escrito el sexo en una planilla y lo lleva a {F,M}; `null` si no se
   * entiende. Es tolerante a propósito: mayúsculas, espacios y acentos son ruido de tipeo, no
   * información. Distinto de `of()`, que es la frontera estricta del dominio.
   */
  parse(raw: unknown): Sex | null {
    if (raw === undefined || raw === null) return null;
    const limpio = String(raw)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    return (ESCRITURAS[limpio] as Sex | undefined) ?? null;
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
