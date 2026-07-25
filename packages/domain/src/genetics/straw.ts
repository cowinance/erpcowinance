/**
 * Estado de una pajuela (GT-2): regla ÚNICA de qué transición vale. Pura, sin I/O.
 *
 * Hasta acá el stock era un contador y su única regla era «no bajar de cero». Con identidad por
 * unidad la pregunta cambia: no es cuántas quedan, es **qué pasó con cada una**. Y esa diferencia
 * importa porque las salidas no son equivalentes — una pajuela usada produjo un servicio, una
 * perdida es plata que se fue sin resultado, y confundirlas hace que la tasa de concepción por toro
 * mienta justamente cuando se la usa para decidir qué semen comprar.
 */

export const STRAW_STATUSES = ['stored', 'reserved', 'used', 'lost', 'discarded', 'sold'] as const;
export type StrawStatus = (typeof STRAW_STATUSES)[number];

/** Motivo por el que una pajuela dejó de estar disponible. */
export const STRAW_EXIT_REASONS: Record<Exclude<StrawStatus, 'stored' | 'reserved'>, string> = {
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
  stored: ['reserved', 'used', 'lost', 'discarded', 'sold'],
  // Reservada es un estado TRANSITORIO: o se usa, o vuelve al stock. Nunca se pierde ni se vende
  // estando reservada — primero hay que soltar el plan, para que la vaca que la tenía asignada no
  // se quede en silencio sin nada con qué servirla.
  reserved: ['stored', 'used'],
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
    if (from === 'reserved')
      throw new InvalidStrawTransitionError(
        'La pajuela está reservada para un animal. Soltá primero esa asignación del plan.',
      );
    throw new InvalidStrawTransitionError(`No se puede pasar de "${from}" a "${to}".`);
  }
}

/**
 * ¿Cuenta como stock LIBRE?
 *
 * Reservada no cuenta: sigue en el termo, pero ya tiene dueña. Si contara, se podrían planificar 30
 * servicios sobre 20 pajuelas y el problema aparecería recién en el corral, con los animales ya
 * sincronizados y sin vuelta atrás.
 */
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
  /** Libres: se pueden reservar o consumir hoy. */
  available: number;
  located: number;
  unlocated: number;
  /** Comprometidas con un animal del plan. Están en el termo, pero no se pueden volver a asignar. */
  reserved: number;
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
    reserved: rows.filter((r) => r.status === 'reserved').length,
    used: rows.filter((r) => r.status === 'used').length,
    other_exits: rows.filter((r) => r.status === 'lost' || r.status === 'discarded' || r.status === 'sold').length,
  };
}
