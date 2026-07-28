/**
 * El hato de ejemplo: qué animales trae y con qué historia.
 *
 * Puro, sin IO. Está acá y no adentro del servicio para que se pueda leer de un vistazo QUÉ ve el
 * productor cuando pide datos de ejemplo, y para que las fechas sean relativas a hoy y no a la
 * fecha en que se escribió el archivo — un ejemplo con pesajes de hace tres años no muestra ninguna
 * ganancia de peso reciente, que es justo lo que se quiere mostrar.
 *
 * El reparto imita una finca de cría chica de verdad: vientres adultos, una recría y un toro. No es
 * decorativo — con vacas y un toro se ve reproducción, con dos pesajes por animal se ve la ganancia
 * diaria, y con eso el Inicio deja de estar vacío y muestra para qué sirve la app.
 */

export interface SampleAnimal {
  readonly tag: string;
  readonly sex: 'F' | 'M';
  /** Sexo que debe tener la categoría a elegir; la categoría concreta sale del catálogo. */
  readonly ageMonths: number;
  readonly lot: string;
  /** Peso del primer pesaje; el segundo se calcula con la ganancia. */
  readonly firstWeightKg: number;
  /** Ganancia diaria, en kg. Distinta por animal: un rodeo donde todos ganan igual no existe. */
  readonly adgKgDay: number;
}

export const SAMPLE_LOTS = ['Rodeo de cría (ejemplo)', 'Levante (ejemplo)'] as const;

/**
 * Las caravanas llevan `EJ-` adelante a propósito.
 *
 * Es lo primero que ve el productor en cualquier listado, y hace que un animal de ejemplo se
 * distinga de uno suyo sin tener que abrirlo. Si algún día el borrado fallara —o alguien cargara
 * los datos de ejemplo sobre una finca que ya trabaja—, la diferencia se ve a simple vista en vez
 * de descubrirse cuando no cierra el conteo del hato.
 */
export const SAMPLE_TAG_PREFIX = 'EJ-';

export const SAMPLE_HERD: readonly SampleAnimal[] = [
  { tag: 'EJ-001', sex: 'F', ageMonths: 56, lot: SAMPLE_LOTS[0], firstWeightKg: 430, adgKgDay: 0.25 },
  { tag: 'EJ-002', sex: 'F', ageMonths: 61, lot: SAMPLE_LOTS[0], firstWeightKg: 455, adgKgDay: 0.18 },
  { tag: 'EJ-003', sex: 'F', ageMonths: 48, lot: SAMPLE_LOTS[0], firstWeightKg: 410, adgKgDay: 0.31 },
  { tag: 'EJ-004', sex: 'F', ageMonths: 52, lot: SAMPLE_LOTS[0], firstWeightKg: 425, adgKgDay: 0.22 },
  { tag: 'EJ-005', sex: 'F', ageMonths: 20, lot: SAMPLE_LOTS[1], firstWeightKg: 265, adgKgDay: 0.62 },
  { tag: 'EJ-006', sex: 'F', ageMonths: 18, lot: SAMPLE_LOTS[1], firstWeightKg: 248, adgKgDay: 0.71 },
  { tag: 'EJ-007', sex: 'M', ageMonths: 22, lot: SAMPLE_LOTS[1], firstWeightKg: 305, adgKgDay: 0.84 },
  { tag: 'EJ-008', sex: 'M', ageMonths: 19, lot: SAMPLE_LOTS[1], firstWeightKg: 288, adgKgDay: 0.79 },
  { tag: 'EJ-009', sex: 'M', ageMonths: 68, lot: SAMPLE_LOTS[0], firstWeightKg: 720, adgKgDay: 0.1 },
];

/** Días atrás de cada uno de los dos pesajes. Dos, porque con uno solo no hay ganancia que mostrar. */
export const SAMPLE_WEIGHING_DAYS_AGO = [75, 12] as const;

/** El segundo peso, derivado del primero y la ganancia: no se guarda un número que se puede calcular. */
export function secondWeightKg(a: SampleAnimal): number {
  const dias = SAMPLE_WEIGHING_DAYS_AGO[0] - SAMPLE_WEIGHING_DAYS_AGO[1];
  return Math.round((a.firstWeightKg + a.adgKgDay * dias) * 10) / 10;
}
