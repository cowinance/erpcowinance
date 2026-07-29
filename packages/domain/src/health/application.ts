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

/**
 * Un hecho de un animal no puede ser anterior a su nacimiento.
 *
 * Se aceptaba: un tratamiento fechado en 1990 sobre un animal nacido en 2025 entraba sin queja. El
 * retiro derivado de ahí no hace daño —venció hace décadas— pero el hecho queda en el historial del
 * animal y en los reportes por período, que cuentan tratamientos, costo y consumo por mes. Un evento
 * 35 años antes de que el animal existiera no se puede explicar ni corregir mirando la pantalla: hay
 * que ir a buscarlo.
 *
 * La guarda simétrica —no en el futuro— ya existía en cada uno de estos servicios. Ésta es la otra
 * mitad del mismo par, y por eso vive al lado de `assertTreatable`: la usan las mismas puertas.
 *
 * **Fechas calendario, comparadas como texto.** Las dos son días, no instantes, y en `YYYY-MM-DD` el
 * orden alfabético ES el cronológico. Convertirlas a `Date` las volvería medianoche UTC y las correría
 * un día en América — el mismo error que ya costó caro en el retiro y en el destete.
 *
 * Sin fecha de nacimiento no se valida nada: un animal comprado sin ese dato es normal, y rechazar
 * sus tratamientos por algo que nadie sabe sería peor que el problema.
 */
export function assertNotBeforeBirth(eventDate: unknown, birthDate: unknown, que: string): void {
  if (birthDate == null || eventDate == null) return;
  const evento = String(eventDate).slice(0, 10);
  const nacimiento = String(birthDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evento) || !/^\d{4}-\d{2}-\d{2}$/.test(nacimiento)) return;
  if (evento < nacimiento)
    throw new HealthApplicationError(
      'health.before_birth',
      `${que} (${evento}) es anterior al nacimiento del animal (${nacimiento}). Revisá la fecha.`,
    );
}
