/**
 * Margen y rentabilidad (G2 · E3) — regla única, DERIVADA.
 *
 * Cierra el circuito del módulo: E1 acumuló el costo, E2 lo volvió unitario, acá se lo enfrenta a lo
 * que se cobró. Es la única función que calcula margen y sus porcentajes, con las guardas que evitan
 * los tres números mentirosos clásicos:
 *
 *  - sin ingresos ⇒ `marginPct: null`. Un lote que gastó y todavía no vendió no tiene "−100% de
 *    rentabilidad sobre ventas": no tiene ventas, que es un estado distinto (hacienda en pie).
 *  - sin costos ⇒ `roiPct: null`. No existe "retorno infinito" sobre una inversión de cero; casi
 *    siempre significa que falta imputar el costo, no que el negocio sea perfecto.
 *  - el margen SÍ se calcula siempre: ingresos − costos es un hecho, aunque dé negativo.
 *
 * `marginPct` (margen sobre ventas) y `roiPct` (retorno sobre lo invertido) responden preguntas
 * distintas —"de cada $100 vendidos, cuánto queda" vs "cuánto rindió cada $100 gastado"— y en el
 * campo se usan las dos, así que se devuelven las dos.
 */
export interface MarginInput {
  revenue: number;
  cost: number;
}

export interface MarginResult {
  /** Ingresos − costos. Siempre presente: es un hecho, aunque sea negativo. */
  margin: number;
  /** Margen sobre ventas, en %. `null` si no hubo ingresos. */
  marginPct: number | null;
  /** Retorno sobre el costo, en %. `null` si no hubo costos. */
  roiPct: number | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function computeMargin(input: MarginInput): MarginResult {
  const revenue = finite(input.revenue);
  const cost = finite(input.cost);
  const margin = round2(revenue - cost);

  return {
    margin,
    marginPct: revenue > 0 ? round2((margin / revenue) * 100) : null,
    roiPct: cost > 0 ? round2((margin / cost) * 100) : null,
  };
}
