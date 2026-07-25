/**
 * Ubicación criogénica: termo → canasta → gobelete (GT-1).
 *
 * Regla ÚNICA de validación de las tres. Puro, sin I/O.
 *
 * POR QUÉ EXISTE ESTA JERARQUÍA Y NO UN CAMPO DE TEXTO. Hasta ahora la ubicación de una partida de
 * semen era `canister varchar(255)`: una nota suelta. Eso alcanza para leerla, no para BUSCAR con
 * ella. Y buscar es todo lo que se hace frente a un termo: alguien con guante, en vapor a −196 °C,
 * tiene que encontrar una canasta y sacar lo que necesita en segundos, porque cada apertura evapora
 * nitrógeno. El color no es decoración: es el criterio real de búsqueda («la azul 2»), y por eso es
 * un campo propio y no parte del nombre.
 */

export class InvalidCryoLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCryoLocationError';
  }
}

/**
 * Colores sugeridos para canastas y gobeletes. NO es una restricción: la finca usa los colores que
 * le vendieron, no los que nosotros listemos. Sirve para que la UI pinte un chip reconocible y para
 * ofrecer los habituales; cualquier otro texto se acepta igual y se muestra sin color.
 */
export const CRYO_COLORS = ['azul', 'rojo', 'verde', 'amarillo', 'blanco', 'negro', 'naranja', 'violeta'] as const;
export type CryoColor = (typeof CRYO_COLORS)[number];

const MAX_CODE = 32;
const MAX_NAME = 120;
const MAX_COLOR = 32;

/** Normaliza un color libre: recortado y en minúsculas. `null` si no se indicó. */
export function normalizeCryoColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return null;
  if (v.length > MAX_COLOR) throw new InvalidCryoLocationError(`el color no puede superar ${MAX_COLOR} caracteres`);
  return v;
}

/** ¿Es uno de los colores que la UI sabe pintar? */
export function isKnownCryoColor(color: string | null): color is CryoColor {
  return color !== null && (CRYO_COLORS as readonly string[]).includes(color);
}

function requiredCode(raw: unknown, campo: string): string {
  if (typeof raw !== 'string') throw new InvalidCryoLocationError(`'${campo}' es obligatorio`);
  const v = raw.trim();
  if (v.length === 0) throw new InvalidCryoLocationError(`'${campo}' es obligatorio`);
  if (v.length > MAX_CODE) throw new InvalidCryoLocationError(`'${campo}' no puede superar ${MAX_CODE} caracteres`);
  return v;
}

export interface TankInput {
  /** Cómo lo llama la finca: «003», «207». Es el identificador que se usa hablando. */
  code: string;
  name: string | null;
  /** Cuántas canastas entran. Si se indica, el sistema no deja cargar de más. */
  canister_capacity: number | null;
  serial_number: string | null;
  notes: string | null;
}

/**
 * El `code` es obligatorio y el `name` no: la finca dice «el 207», no «el termo de la sala de
 * inseminación». Al revés obligaría a inventar un nombre para poder cargar el termo.
 */
export function validateTank(raw: any): TankInput {
  const code = requiredCode(raw?.code, 'code');
  const name = typeof raw?.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim().slice(0, MAX_NAME) : null;

  let canister_capacity: number | null = null;
  if (raw?.canister_capacity !== undefined && raw?.canister_capacity !== null && raw?.canister_capacity !== '') {
    const n = Number(raw.canister_capacity);
    if (!Number.isInteger(n) || n <= 0)
      throw new InvalidCryoLocationError("'canister_capacity' debe ser un entero mayor que cero");
    canister_capacity = n;
  }

  return {
    code,
    name,
    canister_capacity,
    serial_number: typeof raw?.serial_number === 'string' && raw.serial_number.trim() ? raw.serial_number.trim().slice(0, MAX_CODE) : null,
    notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

export interface CanisterInput {
  /** El número de la canasta dentro del termo: «1», «2», «3». */
  code: string;
  color: string | null;
  /** Cuántos gobeletes entran. Mismo criterio que la capacidad del termo. */
  goblet_capacity: number | null;
  notes: string | null;
}

export function validateCanister(raw: any): CanisterInput {
  const code = requiredCode(raw?.code, 'code');

  let goblet_capacity: number | null = null;
  if (raw?.goblet_capacity !== undefined && raw?.goblet_capacity !== null && raw?.goblet_capacity !== '') {
    const n = Number(raw.goblet_capacity);
    if (!Number.isInteger(n) || n <= 0)
      throw new InvalidCryoLocationError("'goblet_capacity' debe ser un entero mayor que cero");
    goblet_capacity = n;
  }

  return {
    code,
    color: normalizeCryoColor(raw?.color),
    goblet_capacity,
    notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

export interface GobletInput {
  code: string;
  color: string | null;
  notes: string | null;
}

export function validateGoblet(raw: any): GobletInput {
  return {
    code: requiredCode(raw?.code, 'code'),
    color: normalizeCryoColor(raw?.color),
    notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

/**
 * Etiqueta corta y hablada de una posición: «207 · azul 2 · gob. 5».
 *
 * Es una sola función y no cada pantalla armando su string porque este texto va a aparecer en la
 * lista de retiro, en la ficha de la pajuela, en el plan de servicio y en el móvil. Si cada canal
 * lo arma distinto, dos pantallas nombran la misma posición de dos formas y quien está frente al
 * termo no sabe si son la misma.
 */
export function cryoLocationLabel(loc: {
  tank_code?: string | null;
  canister_code?: string | null;
  canister_color?: string | null;
  goblet_code?: string | null;
}): string {
  const partes: string[] = [];
  if (loc.tank_code) partes.push(loc.tank_code);
  if (loc.canister_code) partes.push(loc.canister_color ? `${loc.canister_color} ${loc.canister_code}` : `can. ${loc.canister_code}`);
  if (loc.goblet_code) partes.push(`gob. ${loc.goblet_code}`);
  return partes.join(' · ');
}
