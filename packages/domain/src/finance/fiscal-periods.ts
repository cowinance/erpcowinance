/**
 * Los períodos fiscales con los que arranca una finca nueva.
 *
 * El mayor exige un período ABIERTO que contenga la fecha del asiento. Un tenant recién registrado
 * no tenía ninguno, así que la primera venta que intentaba asentarse moría con «No hay un período
 * fiscal abierto que contenga la fecha …» — un mensaje que le pide al productor que sepa qué es un
 * período fiscal antes de haber vendido su primer novillo.
 *
 * Mensual y por año calendario: es como piensa el productor («lo de julio») y como cierra cualquier
 * contador. Puro, sin IO — la aritmética es de calendario y no toca husos horarios.
 */

export interface FiscalPeriodSeed {
  readonly name: string;
  /** `YYYY-MM-DD`, inclusive. */
  readonly start_date: string;
  /** `YYYY-MM-DD`, inclusive: el último día real del mes. */
  readonly end_date: string;
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** `YYYY-MM-DD` de un día concreto, armado sobre el calendario UTC (todos los días miden lo mismo). */
function fecha(year: number, month0: number, day: number): string {
  return new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
}

/**
 * Los 12 períodos mensuales de un año.
 *
 * El último día sale de `Date.UTC(año, mes + 1, 0)`, que es el día CERO del mes siguiente: así
 * febrero da 28 o 29 según corresponda sin una tabla de días por mes que envejece mal.
 */
export function monthlyPeriods(year: number): FiscalPeriodSeed[] {
  return MESES.map((nombre, m) => ({
    name: `${nombre} ${year}`,
    start_date: fecha(year, m, 1),
    end_date: fecha(year, m + 1, 0),
  }));
}

/**
 * Los períodos con los que se da de alta una finca: el año en curso y el siguiente.
 *
 * Se incluye el año siguiente por una razón concreta: si solo se creara el actual, el 1 de enero
 * **toda** la contabilidad dejaría de asentar de golpe, en la fecha en que menos ganas hay de
 * descubrirlo. Con dos años el corte queda lejos y avisado.
 *
 * No resuelve el problema para siempre —alguien tiene que generar los períodos del tercer año—,
 * pero ese camino ya existe: `POST /finance/periods` los crea a mano.
 */
export function initialFiscalPeriods(currentYear: number): FiscalPeriodSeed[] {
  return [...monthlyPeriods(currentYear), ...monthlyPeriods(currentYear + 1)];
}
