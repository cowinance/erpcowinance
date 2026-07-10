import type { Brand } from '../shared/brand';
import { DomainError } from '../shared/domain-error';

/**
 * Weight — un peso del dominio ganadero. Garantías que aporta como Value Object:
 *  - validación: estrictamente positivo y finito;
 *  - comportamiento: constructores unit-aware (kg/lb) que convierten a la unidad
 *    canónica, comparación, y conversión de presentación kg↔lb;
 *  - inmutabilidad y type-safety: no es "cualquier number".
 *
 * Unidad canónica: **kilogramos (SI)**. El dominio siempre almacena y razona en
 * kg; libras es únicamente una unidad de entrada/presentación — la conversión
 * vive acá, en un solo lugar. Qué unidad mostrar es decisión de la UI/tenant,
 * no del dominio.
 *
 * Precisión: `WEIGHT_SCALE` es una decisión del dominio ganadero (no de la
 * columna SQL, que hoy coincide por coincidencia, no por dependencia). El VO
 * normaliza a esta escala al construirse, así el comportamiento es el mismo
 * sin importar el motor de persistencia o la precisión nativa de la fuente
 * (báscula Bluetooth, sensor IoT, importador, API externa).
 */

const KG_PER_LB = 0.45359237; // factor internacional exacto

/** Decimales que el dominio reconoce para un peso, en kg. */
export const WEIGHT_SCALE = 3;

export type Weight = Brand<number, 'Weight'>;

export class InvalidWeight extends DomainError {
  readonly code = 'domain.invalid_weight';
  constructor(
    readonly value: unknown,
    reason: string,
  ) {
    super(`Peso inválido: ${reason}`);
  }
}

function round(kg: number): number {
  const factor = 10 ** WEIGHT_SCALE;
  return Math.round(kg * factor) / factor;
}

function fromKg(raw: unknown): Weight {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new InvalidWeight(raw, 'debe ser un número finito');
  if (raw <= 0) throw new InvalidWeight(raw, 'debe ser mayor que cero');
  return round(raw) as Weight;
}

export const Weight = {
  /** Construye un peso a partir de kilogramos; lanza InvalidWeight si no es válido. */
  kg(value: number): Weight {
    return fromKg(value);
  },
  /** Construye un peso a partir de libras, convirtiendo a la unidad canónica (kg). */
  lb(value: number): Weight {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidWeight(value, 'debe ser un número finito');
    return fromKg(value * KG_PER_LB);
  },
  /** ¿`kg()` tendría éxito con este valor? */
  isValid(raw: unknown): boolean {
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0;
  },
  /** Valor canónico en kilogramos. */
  toKg(w: Weight): number {
    return w as number;
  },
  /** Valor de presentación en libras (no persiste; se recalcula al vuelo). */
  toLb(w: Weight): number {
    return (w as number) / KG_PER_LB;
  },
  /** Igualdad exacta sobre el valor canónico (kg, ya normalizado a WEIGHT_SCALE). */
  equals(a: Weight, b: Weight): boolean {
    return (a as number) === (b as number);
  },
  /** Comparador estándar: negativo si a<b, cero si iguales, positivo si a>b. */
  compare(a: Weight, b: Weight): number {
    return (a as number) - (b as number);
  },
  min(a: Weight, b: Weight): Weight {
    return (a as number) <= (b as number) ? a : b;
  },
  max(a: Weight, b: Weight): Weight {
    return (a as number) >= (b as number) ? a : b;
  },
};
