/**
 * Validación de entradas de catálogos maestros (A3 · Configuración) — regla única. Los catálogos con
 * `tenant_id` nullable (razas, diagnósticos) admiten extensión por tenant: la base global vive con
 * `tenant_id IS NULL` y cada tenant agrega los suyos. Acá se normaliza y valida la entrada antes de
 * persistir; la unicidad y el scoping por tenant los aplica el servicio.
 */
export const BREED_PURPOSES = ['beef', 'dairy', 'dual', 'wool', 'work'] as const;
export type BreedPurpose = (typeof BREED_PURPOSES)[number];

export class InvalidCatalogEntryError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidCatalogEntryError';
  }
}

export function normalizeCatalogCode(code: unknown): string {
  const c = String(code ?? '').trim();
  if (!c) throw new InvalidCatalogEntryError('El código es obligatorio');
  if (c.length > 64) throw new InvalidCatalogEntryError('El código no puede superar 64 caracteres');
  return c;
}

export function normalizeCatalogName(name: unknown): string {
  const n = String(name ?? '').trim();
  if (!n) throw new InvalidCatalogEntryError('El nombre es obligatorio');
  return n;
}

/** Aptitud de raza: opcional, pero si viene debe pertenecer al enum. */
export function assertBreedPurpose(purpose: unknown): BreedPurpose | null {
  if (purpose == null || purpose === '') return null;
  if (!(BREED_PURPOSES as readonly string[]).includes(String(purpose))) {
    throw new InvalidCatalogEntryError(`Aptitud inválida: ${String(purpose)}`);
  }
  return purpose as BreedPurpose;
}

export interface BreedInput {
  code: string;
  name: string;
  purpose: BreedPurpose | null;
}

export function validateBreedInput(input: { code?: unknown; name?: unknown; purpose?: unknown }): BreedInput {
  return {
    code: normalizeCatalogCode(input.code),
    name: normalizeCatalogName(input.name),
    purpose: assertBreedPurpose(input.purpose),
  };
}

export interface DiagnosisInput {
  code: string;
  name: string;
  category: string | null;
  isNotifiable: boolean;
}

export function validateDiagnosisInput(input: { code?: unknown; name?: unknown; category?: unknown; is_notifiable?: unknown }): DiagnosisInput {
  const rawCat = input.category == null ? '' : String(input.category).trim();
  return {
    code: normalizeCatalogCode(input.code),
    name: normalizeCatalogName(input.name),
    category: rawCat === '' ? null : rawCat,
    isNotifiable: Boolean(input.is_notifiable),
  };
}
