/**
 * Rotación del inventario: para cuántos días alcanza, y qué plata está quieta (Fase 4).
 *
 * El kardex ya dice cuánto hay y cuánto costó. No dice las dos cosas que se preguntan de verdad:
 * **¿para cuántos días me alcanza?** y **¿qué compré que no uso?**
 *
 * Hay un hueco silencioso que esta regla viene a tapar. La alerta de stock bajo (`stock_below_reorder`)
 * dispara cuando el saldo cae bajo `inventory_items.reorder_point`… que es un número que alguien
 * tiene que haber cargado a mano. En un ítem donde nadie lo cargó, la alerta NUNCA suena: la finca
 * se queda sin antiparasitario en plena campaña y el sistema no dijo nada. Acá el punto de
 * reposición se DERIVA del consumo real, así que existe aunque nadie haya cargado nada.
 *
 * Dos decisiones sobre qué se cuenta:
 *
 * - **Consumo es lo que SALIÓ**, no todo movimiento. Una compra sube el stock y no es consumo;
 *   contarla haría parecer que un ítem rota cuando lo único que pasó fue que se compró.
 * - **La transferencia entre depósitos NO es consumo.** Mover bolsas de un galpón a otro no gastó
 *   nada, y contarlo inflaría el consumo diario y con él el punto de reposición sugerido: el
 *   sistema recomendaría comprar de más.
 *
 * Puro, sin IO.
 */

export type StockStatus =
  /** Sin saldo: ya frenó el trabajo. */
  | 'sin_stock'
  /** El saldo no llega a cubrir el tiempo que tarda reponer. */
  | 'critico'
  /** Alcanza. */
  | 'normal'
  /** Hay saldo y no se consumió nada en el período: plata quieta. */
  | 'dormido';

export interface StockRotationInput {
  /** Saldo actual sumando todos los depósitos. */
  stock: number | null;
  /** Cantidad que SALIÓ en el período (consumos y ventas; no transferencias ni compras). */
  consumed: number | null;
  /** Días del período analizado. */
  periodDays: number;
  /** Costo promedio ponderado del ítem. */
  avgCost?: number | null;
  /** Días sin ningún movimiento. `null` si nunca se movió. */
  daysSinceMovement?: number | null;
  /** Punto de reposición cargado a mano, si lo hay. */
  reorderPoint?: number | null;
}

export interface StockRotationOptions {
  /**
   * Días que tarda en llegar una reposición. Es lo único que el sistema no puede derivar del dato
   * —depende del proveedor y del camino—, así que es un parámetro con un defecto conservador.
   */
  leadTimeDays?: number;
}

export interface StockRotation {
  stock: number;
  consumed: number;
  /** Consumo por día del período. `null` si no se consumió nada: no es cero por día, es sin datos. */
  dailyUse: number | null;
  /** Para cuántos días alcanza el saldo. `null` cuando no hay consumo con qué proyectar. */
  coverageDays: number | null;
  /** Veces que el saldo actual se renovaría en un año al ritmo del período. */
  turnsPerYear: number | null;
  /** Punto de reposición DERIVADO del consumo real: lo que se gasta mientras llega la reposición. */
  suggestedReorderPoint: number | null;
  /** Plata inmovilizada en este ítem. */
  stockValue: number | null;
  status: StockStatus;
  caveat: string | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
const positivo = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** Días que se suponen hasta que llega una reposición, cuando no se indica otro. */
export const DEFAULT_LEAD_TIME_DAYS = 30;

export function computeStockRotation(input: StockRotationInput, opts: StockRotationOptions = {}): StockRotation {
  const lead = positivo(opts.leadTimeDays) || DEFAULT_LEAD_TIME_DAYS;
  const stock = round3(positivo(input.stock));
  const consumed = round3(positivo(input.consumed));
  const dias = positivo(input.periodDays);

  // Sin consumo no hay ritmo con qué proyectar. Un cero por día haría que la cobertura diera
  // infinito y el ítem se leyera como «tengo de sobra», cuando lo que pasa es que no se usa.
  const dailyUse = consumed > 0 && dias > 0 ? round3(consumed / dias) : null;
  const coverageDays = dailyUse != null && dailyUse > 0 ? Math.round(stock / dailyUse) : null;
  const turnsPerYear = dailyUse != null && stock > 0 ? round2((dailyUse * 365) / stock) : null;
  const suggestedReorderPoint = dailyUse != null ? round2(dailyUse * lead) : null;

  // `Number(null)` es 0 y es finito: sin este corte, un ítem sin costo cargado valdría 0 y se
  // leería como «no vale nada» en vez de «no se sabe cuánto vale». Con eso, el total de plata
  // quieta saldría más bajo que la realidad, que es el error que menos se nota.
  const costo = input.avgCost == null ? Number.NaN : Number(input.avgCost);
  const stockValue = Number.isFinite(costo) && costo >= 0 ? round2(stock * costo) : null;

  const status = clasificar(stock, dailyUse, coverageDays, lead);
  return {
    stock,
    consumed,
    dailyUse,
    coverageDays,
    turnsPerYear,
    suggestedReorderPoint,
    stockValue,
    status,
    caveat: avisoDe({ status, coverageDays, lead, stockValue, suggestedReorderPoint, input }),
  };
}

function clasificar(stock: number, dailyUse: number | null, coverageDays: number | null, lead: number): StockStatus {
  if (stock <= 0) return 'sin_stock';
  if (dailyUse == null) return 'dormido';
  return coverageDays != null && coverageDays < lead ? 'critico' : 'normal';
}

/**
 * Cuánto puede desviarse el punto cargado a mano del derivado antes de que valga nombrarlo. Por
 * debajo de esto la diferencia es ruido del período, no un número viejo.
 */
export const REORDER_DRIFT_RATIO = 2;

function avisoDe(o: {
  status: StockStatus;
  coverageDays: number | null;
  lead: number;
  stockValue: number | null;
  suggestedReorderPoint: number | null;
  input: StockRotationInput;
}): string | null {
  if (o.status === 'sin_stock') return 'Sin saldo. Si se sigue usando, el trabajo ya está frenado.';
  if (o.status === 'critico')
    return `Alcanza para ${o.coverageDays} días y la reposición tarda ${o.lead}. Al ritmo del período, se termina antes de que llegue lo que se pida hoy.`;
  if (o.status === 'dormido') {
    const meses = o.input.daysSinceMovement != null ? Math.floor(o.input.daysSinceMovement / 30) : null;
    const plata = o.stockValue != null && o.stockValue > 0 ? ` Son ${o.stockValue} quietos.` : '';
    return meses != null && meses > 0
      ? `Sin consumo en el período y ${meses} ${meses === 1 ? 'mes' : 'meses'} sin ningún movimiento.${plata}`
      : `Hay saldo y no se consumió nada en el período.${plata}`;
  }

  // El mínimo cargado a mano quedó lejos del consumo real. Importa porque de ese número depende la
  // alerta de stock bajo: si está viejo, avisa tarde (y se corta) o avisa siempre (y se ignora), y
  // en los dos casos nadie se entera de que el problema es el número y no el stock.
  const manual = Number(o.input.reorderPoint);
  const sugerido = o.suggestedReorderPoint;
  if (Number.isFinite(manual) && manual > 0 && sugerido != null && sugerido > 0) {
    if (manual >= sugerido * REORDER_DRIFT_RATIO)
      return `El mínimo cargado (${manual}) es muy alto para lo que se consume: el aviso de stock bajo va a saltar casi siempre. Al ritmo del período alcanzaría con ${sugerido}.`;
    if (sugerido >= manual * REORDER_DRIFT_RATIO)
      return `El mínimo cargado (${manual}) quedó corto para lo que se consume hoy: el aviso llegaría tarde. Al ritmo del período convendría ${sugerido}.`;
  }
  return null;
}
