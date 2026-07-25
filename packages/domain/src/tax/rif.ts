/**
 * RIF — Registro Único de Información Fiscal (Venezuela, G4-1). Regla única de identidad fiscal.
 *
 * El RIF es `LETRA-8 dígitos-dígito verificador` (p. ej. `J-00123072-6`). El último dígito NO es
 * parte del número: se CALCULA a partir de los otros nueve. Por eso acá no hay un regex sino la
 * aritmética — un regex acepta `J-00123072-4`, que es un RIF con la forma correcta y el número
 * equivocado. En una factura eso importa: el RIF errado del cliente invalida el comprobante y el
 * crédito fiscal que el cliente pretenda descontar con él.
 *
 * Puro, sin IO. Lo usan por igual la web, el móvil y la API.
 *
 * ── El algoritmo ────────────────────────────────────────────────────────────────────────────────
 *   suma  = valor(letra) + Σ (dígito_i × peso_i)   con pesos [3,2,7,6,5,4,3,2]
 *   resto = suma mód 11
 *   dv    = 11 − resto,  y si dv ≥ 10 → 0
 *
 * VERIFICADO contra un RIF real y público: PDVSA Petróleo, S.A. es `J-00123072-6`, y el algoritmo
 * reproduce ese 6 (ver el test). Se contrastó además con dos implementaciones independientes que
 * coinciden en la tabla de letras y en los pesos.
 */

/** Tipos de contribuyente que codifica la letra inicial. */
export const RIF_PREFIXES = ['V', 'E', 'J', 'P', 'G'] as const;
export type RifPrefix = (typeof RIF_PREFIXES)[number];

/**
 * Valor con el que cada letra entra en la suma. Ya viene multiplicado por el peso de la posición 0
 * (V=1, E=2, J=3, P=4, G=5, todos ×4), que es como lo expresan las implementaciones de referencia.
 */
const PREFIX_VALUE: Record<RifPrefix, number> = { V: 4, E: 8, J: 12, P: 16, G: 20 };

/** Pesos de los 8 dígitos, de izquierda a derecha. */
const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Qué es cada letra, para poder explicarlo en la UI en vez de mostrar un código. */
export const RIF_PREFIX_LABEL: Record<RifPrefix, string> = {
  V: 'Persona natural venezolana',
  E: 'Persona natural extranjera',
  J: 'Persona jurídica',
  P: 'Pasaporte',
  G: 'Ente gubernamental',
};

export interface ParsedRif {
  /** Letra normalizada en mayúscula. */
  prefix: RifPrefix;
  /** Los 8 dígitos del cuerpo, con ceros a la izquierda. */
  body: string;
  /** El dígito verificador declarado. */
  checkDigit: number;
  /** Forma canónica `J-00123072-6`, que es como se imprime en el comprobante. */
  formatted: string;
}

export type RifProblem =
  | 'empty'
  | 'bad_prefix'
  | 'bad_length'
  | 'not_numeric'
  | 'bad_check_digit';

export class InvalidRifError extends Error {
  constructor(
    readonly problem: RifProblem,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidRifError';
  }
}

const PROBLEM_MESSAGE: Record<RifProblem, string> = {
  empty: 'El RIF es obligatorio',
  bad_prefix: `El RIF debe empezar con una letra ${RIF_PREFIXES.join(', ')}`,
  bad_length: 'El RIF debe tener 8 dígitos y el dígito verificador (por ejemplo J-00123072-6)',
  not_numeric: 'El RIF solo admite dígitos después de la letra',
  bad_check_digit: 'El dígito verificador no corresponde: revisá el número',
};

/**
 * Deja el RIF en sus caracteres significativos: mayúsculas, sin guiones, espacios ni puntos. La
 * gente lo escribe de todas las formas (`J301234567`, `j-30123456-7`, `J 30123456 7`) y las tres
 * son el mismo RIF; guardar variantes de la misma identidad es lo que después duplica clientes.
 */
export function normalizeRif(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * Dígito verificador para una letra y un cuerpo de 8 dígitos. Es la única aritmética del módulo:
 * validar y completar un RIF se apoyan las dos acá.
 */
export function rifCheckDigit(prefix: RifPrefix, body: string): number {
  let sum = PREFIX_VALUE[prefix];
  for (let i = 0; i < WEIGHTS.length; i++) sum += Number(body[i]) * WEIGHTS[i];
  const dv = 11 - (sum % 11);
  // 10 y 11 no son dígitos: el resto 0 y el resto 1 colapsan los dos en 0. Es la razón por la que
  // el 0 aparece más seguido que cualquier otro dígito verificador.
  return dv >= 10 ? 0 : dv;
}

/** Descompone un RIF sin validar el dígito. Devuelve el problema de FORMA si lo hay. */
function parseShape(raw: string): { parsed: Omit<ParsedRif, 'formatted'> } | { problem: RifProblem } {
  const s = normalizeRif(raw);
  if (!s) return { problem: 'empty' };
  const prefix = s[0] as RifPrefix;
  if (!(RIF_PREFIXES as readonly string[]).includes(prefix)) return { problem: 'bad_prefix' };
  const rest = s.slice(1);
  if (rest.length !== 9) return { problem: 'bad_length' };
  if (!/^\d{9}$/.test(rest)) return { problem: 'not_numeric' };
  return { parsed: { prefix, body: rest.slice(0, 8), checkDigit: Number(rest[8]) } };
}

/** ¿Es un RIF válido, dígito verificador incluido? */
export function isValidRif(raw: string): boolean {
  const r = parseShape(raw);
  if ('problem' in r) return false;
  return rifCheckDigit(r.parsed.prefix, r.parsed.body) === r.parsed.checkDigit;
}

/**
 * Valida y normaliza. Lanza `InvalidRifError` con el problema concreto — la UI necesita decir QUÉ
 * está mal, no un «RIF inválido» que no le dice a nadie dónde mirar.
 */
export function parseRif(raw: string): ParsedRif {
  const r = parseShape(raw);
  if ('problem' in r) throw new InvalidRifError(r.problem, PROBLEM_MESSAGE[r.problem]);
  const { prefix, body, checkDigit } = r.parsed;
  if (rifCheckDigit(prefix, body) !== checkDigit)
    throw new InvalidRifError('bad_check_digit', PROBLEM_MESSAGE.bad_check_digit);
  return { prefix, body, checkDigit, formatted: `${prefix}-${body}-${checkDigit}` };
}

/**
 * Completa el dígito verificador de un RIF al que le falta — sirve para la carga asistida: el
 * usuario tipea `J-00123072` y la UI le propone el `-6`. NO es para inventar RIFs: si el número
 * está mal, el dígito calculado también lo estará.
 */
export function completeRif(raw: string): string {
  const s = normalizeRif(raw);
  const prefix = s[0] as RifPrefix;
  if (!(RIF_PREFIXES as readonly string[]).includes(prefix))
    throw new InvalidRifError('bad_prefix', PROBLEM_MESSAGE.bad_prefix);
  const body = s.slice(1);
  if (!/^\d{8}$/.test(body)) throw new InvalidRifError('bad_length', PROBLEM_MESSAGE.bad_length);
  return `${prefix}-${body}-${rifCheckDigit(prefix, body)}`;
}
