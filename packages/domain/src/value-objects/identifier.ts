import type { Brand } from '../shared/brand';
import { DomainError } from '../shared/domain-error';

/**
 * Maquinaria compartida de los identificadores tipados del dominio.
 * La regla "un identificador válido es un UUID" se define UNA sola vez acá
 * (Regla Permanente 1). Los IDs concretos (TenantId, FarmId, …) se generan con
 * `makeIdentifier` y sólo se distinguen por su marca nominal.
 */

// UUID laxo: acepta v4 (gen_random_uuid, hoy) y v7 (recomendado en prod).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export class InvalidIdentifier extends DomainError {
  readonly code = 'domain.invalid_identifier';
  constructor(
    readonly kind: string,
    readonly value: unknown,
  ) {
    super(`${kind} inválido: se esperaba un UUID`);
  }
}

export interface IdentifierFactory<Id extends string> {
  /** Construye el ID validando que sea un UUID; lanza InvalidIdentifier si no. */
  of(value: string): Id;
  /** Type guard: ¿es un valor válido para este ID? */
  isValid(value: unknown): value is Id;
}

export function makeIdentifier<K extends string>(kind: K): IdentifierFactory<Brand<string, K>> {
  type Id = Brand<string, K>;
  return {
    of(value: string): Id {
      if (!isUuid(value)) throw new InvalidIdentifier(kind, value);
      return value as Id;
    },
    isValid(value: unknown): value is Id {
      return isUuid(value);
    },
  };
}
