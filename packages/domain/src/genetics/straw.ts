/**
 * Estado de una pajuela (GT-2): regla ÚNICA de qué transición vale. Pura, sin I/O.
 *
 * Hasta acá el stock era un contador y su única regla era «no bajar de cero». Con identidad por
 * unidad la pregunta cambia: no es cuántas quedan, es **qué pasó con cada una**. Y esa diferencia
 * importa porque las salidas no son equivalentes — una pajuela usada produjo un servicio, una
 * perdida es plata que se fue sin resultado, y confundirlas hace que la tasa de concepción por toro
 * mienta justamente cuando se la usa para decidir qué semen comprar.
 */

export const STRAW_STATUSES = ['stored', 'used', 'lost', 'discarded', 'sold'] as const;
export type StrawStatus = (typeof STRAW_STATUSES)[number];

/** Motivo por el que una pajuela dejó de estar disponible. */
export const STRAW_EXIT_REASONS: Record<Exclude<StrawStatus, 'stored'>, string> = {
  used: 'Usada en un servicio',
  lost: 'Descongelada y no utilizada',
  discarded: 'Descartada (vencida o rechazada)',
  sold: 'Vendida o cedida',
};

export class InvalidStrawTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStrawTransitionError';
  }
}

/**
 * Transiciones válidas.
 *
 * De `stored` se sale hacia cualquier destino. La vuelta atrás se permite desde `lost`, `discarded`
 * y `sold` —son errores de registro, y la pajuela sigue físicamente en el termo— pero NO desde
 * `used`: una usada está atada a un servicio real. Devolverla al stock dejaría un evento
 * reproductivo apuntando a una pajuela que el sistema cree entera. Para deshacer un consumo hay que
 * deshacer el servicio, que es donde de verdad está el error.
 */
export const STRAW_TRANSITIONS: Record<StrawStatus, readonly StrawStatus[]> = {
  stored: ['used', 'lost', 'discarded', 'sold'],
  used: [],
  lost: ['stored'],
  discarded: ['stored'],
  sold: ['stored'],
};

export function assertStrawTransition(from: StrawStatus, to: StrawStatus): void {
  if (from === to) throw new InvalidStrawTransitionError(`La pajuela ya está en estado "${from}".`);
  if (!STRAW_TRANSITIONS[from]?.includes(to)) {
    if (from === 'used')
      throw new InvalidStrawTransitionError(
        'La pajuela ya se usó en un servicio. Para devolverla al stock hay que corregir ese servicio.',
      );
    throw new InvalidStrawTransitionError(`No se puede pasar de "${from}" a "${to}".`);
  }
}

/** ¿Cuenta como stock disponible? Una sola definición, usada por el saldo y por la reserva. */
export function isStrawAvailable(status: StrawStatus): boolean {
  return status === 'stored';
}

export interface StrawBatchInput {
  quantity: number;
  goblet_id: string | null;
  code: string | null;
  notes: string | null;
}

const MAX_BATCH = 500;

/**
 * Alta en bloque: «20 pajuelas del toro Sansão». El tope no es técnico —500 filas no son nada— sino
 * un freno al dedo pegado en el teclado numérico: un 2000 de más generaría stock que después hay
 * que borrar de a una.
 */
export function validateStrawBatch(raw: any): StrawBatchInput {
  const n = Number(raw?.quantity);
  if (!Number.isInteger(n) || n <= 0)
    throw new InvalidStrawTransitionError("'quantity' debe ser un entero mayor que cero");
  if (n > MAX_BATCH) throw new InvalidStrawTransitionError(`No se pueden cargar más de ${MAX_BATCH} pajuelas de una vez`);

  const code = typeof raw?.code === 'string' && raw.code.trim() ? raw.code.trim().slice(0, 64) : null;
  // Un código impreso identifica UNA pajuela. Repetirlo en veinte las volvería indistinguibles, que
  // es exactamente lo que el código venía a resolver.
  if (code && n > 1)
    throw new InvalidStrawTransitionError('El código impreso identifica una sola pajuela: cargalas de a una o dejalo vacío.');

  return {
    quantity: n,
    goblet_id: typeof raw?.goblet_id === 'string' && raw.goblet_id.trim() ? raw.goblet_id.trim() : null,
    code,
    notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

export interface StrawCounts {
  available: number;
  located: number;
  unlocated: number;
  used: number;
  other_exits: number;
}

/**
 * Resumen de un conjunto de pajuelas.
 *
 * `unlocated` está separado a propósito: son las que existen pero nadie sabe dónde. Mezclarlas con
 * las disponibles daría un saldo que parece completo mientras media partida es, en la práctica,
 * imposible de encontrar dentro del termo.
 */
export function summarizeStraws(rows: readonly { status: StrawStatus; goblet_id: string | null }[]): StrawCounts {
  const disponibles = rows.filter((r) => isStrawAvailable(r.status));
  return {
    available: disponibles.length,
    located: disponibles.filter((r) => r.goblet_id !== null).length,
    unlocated: disponibles.filter((r) => r.goblet_id === null).length,
    used: rows.filter((r) => r.status === 'used').length,
    other_exits: rows.filter((r) => r.status === 'lost' || r.status === 'discarded' || r.status === 'sold').length,
  };
}
