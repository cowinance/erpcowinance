/**
 * Aplicación sanitaria (tratamiento / vacunación) — reglas puras compartidas por
 * todos los canales (REST y sync). No se puede aplicar un producto veterinario a un
 * animal que no esté ACTIVO: tratar/vacunar un animal muerto, vendido o inactivo es
 * un error de negocio (el retiro derivado carecería de sentido y ensuciaría los KPIs).
 *
 * Funciones puras: sin I/O, sin catálogo, sin tenant. El servicio decide CUÁNDO
 * llamarlas y cómo mapear el error (400/409 en REST, conflicto semántico en sync).
 */

/** Único estado en el que un animal admite tratamiento o vacunación. */
export const TREATABLE_STATUS = 'active' as const;

export class HealthApplicationError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'HealthApplicationError';
  }
}

/** true si el estado del animal admite una aplicación sanitaria. */
export function isTreatableStatus(status: unknown): boolean {
  return status === TREATABLE_STATUS;
}

/**
 * Valida que el animal esté activo para recibir un tratamiento/vacuna.
 * Lanza `HealthApplicationError` (que el servicio traduce a 409/conflicto) si no lo está.
 */
export function assertTreatable(status: unknown, tag?: string | null): void {
  if (isTreatableStatus(status)) return;
  const who = tag ? `El animal ${tag}` : 'El animal';
  throw new HealthApplicationError(
    'animal.not_treatable',
    `${who} no está activo (estado: ${String(status)}) — no se puede aplicar un producto veterinario`,
  );
}
