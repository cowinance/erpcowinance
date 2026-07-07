import type { Brand } from '../shared/brand';
import { DomainError } from '../shared/domain-error';

/**
 * TagNumber — la **caravana visual** de un animal (el número que se lee a ojo
 * en el campo). Garantías que aporta como Value Object:
 *  - validación: una caravana no puede estar vacía;
 *  - comportamiento: normaliza (recorta espacios) para que la misma caravana
 *    escrita distinto sea el mismo valor — centraliza una regla hoy dispersa;
 *  - type-safety: no es "cualquier string".
 *
 * Alcance deliberado: representa SOLO la identificación visual. Un animal podrá
 * tener otros mecanismos (RFID/EID, oficial, interno); esos serán Value Objects
 * hermanos (p. ej. `RfidTag`, `OfficialId`) con sus propias reglas — NO variantes
 * de éste. Este diseño no lo impide, pero tampoco lo construye todavía (YAGNI).
 */

const MAX_LENGTH = 255; // límite de la columna animal_identifiers.value

export type TagNumber = Brand<string, 'TagNumber'>;

export class InvalidTagNumber extends DomainError {
  readonly code = 'domain.invalid_tag_number';
  constructor(
    readonly value: unknown,
    reason: string,
  ) {
    super(`Caravana inválida: ${reason}`);
  }
}

function normalize(raw: string): string {
  return raw.trim();
}

export const TagNumber = {
  /** Construye la caravana normalizada; lanza InvalidTagNumber si no es válida. */
  of(raw: string): TagNumber {
    const value = typeof raw === 'string' ? normalize(raw) : '';
    if (value.length === 0) throw new InvalidTagNumber(raw, 'no puede estar vacía');
    if (value.length > MAX_LENGTH) throw new InvalidTagNumber(raw, `supera ${MAX_LENGTH} caracteres`);
    return value as TagNumber;
  },
  /** ¿`of()` tendría éxito con este valor? (no normaliza; sólo verifica). */
  isValid(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    const value = normalize(raw);
    return value.length > 0 && value.length <= MAX_LENGTH;
  },
};
