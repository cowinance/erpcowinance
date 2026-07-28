/**
 * Consanguinidad: cuánto se parientan de verdad dos animales.
 *
 * **Qué reemplaza.** El sistema avisaba de consanguinidad mirando UNA generación: mismo padre,
 * misma madre, o padre/hija directa. Eso deja pasar el caso que más aparece en una finca de cría:
 * **abuelo × nieta**. Un toro se queda tres o cuatro años en el rodeo; sus hijas entran a servicio
 * —eso sí se detectaba— y después entran las hijas de sus hijas, y ahí no decía nada. Es justo
 * cuando la consanguinidad empieza a cobrarse: terneros más livianos, más partos difíciles, menos
 * fertilidad. Y el daño no se deshace: queda en el hato.
 *
 * **Y por qué un número y no un sí/no.** El aviso viejo era binario: un apareamiento padre-hija
 * (F = 25%) y uno entre primos lejanos (F = 3%) disparaban lo mismo. Uno hay que impedirlo y el
 * otro es normal en cualquier rodeo cerrado. Un umbral binario obliga a elegir entre bloquear
 * apareamientos sanos o dejar pasar los malos; con un coeficiente, el umbral se discute aparte de
 * la medición.
 *
 * **El método.** Coeficiente de Wright por la recursión de parentesco (kinship), que es exacta —no
 * una aproximación— sobre el pedigrí que se conozca:
 *
 *   f(a, a) = ½ · (1 + F(a))            ← un animal consigo mismo; F(a) = f(padre_a, madre_a)
 *   f(a, b) = ½ · (f(padre_a, b) + f(madre_a, b))
 *   f(a, ?) = 0                          ← ancestro desconocido: no aporta parentesco
 *
 * Y el dato que le interesa al productor: **F de la cría** de un apareamiento = f(padre, madre).
 *
 * De ahí salen los valores conocidos, que sirven para leer el resultado: padre × hija y hermanos
 * enteros dan 25%; medios hermanos y abuelo × nieta dan 12,5%; primos hermanos, 6,25%.
 *
 * Puro, sin IO: recibe el pedigrí ya cargado y devuelve números.
 */

/** Padres conocidos de un animal. `null` donde el pedigrí se corta. */
export interface PedigreeNode {
  readonly sireId: string | null;
  readonly damId: string | null;
}

/** El pedigrí como lo entrega la base: id → padres. Lo que no está, se trata como desconocido. */
export type Pedigree = ReadonlyMap<string, PedigreeNode>;

/**
 * Profundidad de generaciones de un animal (0 = sin padres conocidos).
 *
 * Se usa para decidir a CUÁL de los dos animales expandir en la recursión: siempre al más
 * profundo. Sin ese orden, `f(a, b)` podría expandir a un ancestro de `b` y volver a caer en `b`,
 * y la recursión no terminaría.
 *
 * `visitando` corta los ciclos. Un pedigrí con un ciclo (un animal que termina siendo su propio
 * ancestro) es un dato imposible que ya existe en la base por una carga mal hecha; la alternativa
 * a cortarlo es que la pantalla de servicio se cuelgue, que es peor que un número aproximado.
 */
function generationDepth(id: string | null, ped: Pedigree, memo: Map<string, number>, visitando: Set<string>): number {
  if (id === null) return 0;
  const cache = memo.get(id);
  if (cache !== undefined) return cache;
  if (visitando.has(id)) return 0; // ciclo: se corta acá
  const nodo = ped.get(id);
  if (!nodo) return 0;

  visitando.add(id);
  const d = 1 + Math.max(generationDepth(nodo.sireId, ped, memo, visitando), generationDepth(nodo.damId, ped, memo, visitando));
  visitando.delete(id);

  memo.set(id, d);
  return d;
}

/** Estado compartido entre llamadas, para no recalcular el mismo parentesco muchas veces. */
interface Contexto {
  ped: Pedigree;
  kin: Map<string, number>;
  depth: Map<string, number>;
  /**
   * Pares cuyo parentesco se está calculando en este momento.
   *
   * Corta la recursión cuando el pedigrí se muerde la cola. El caso que lo destapó: un animal
   * cargado como su propio padre. Al expandirlo se volvía a pedir el mismo par y la pila se
   * desbordaba — no un número raro, un `RangeError` que voltea la pantalla de servicio con el
   * productor y el animal esperando en la manga.
   */
  enCurso: Set<string>;
}

function profundidad(id: string, ctx: Contexto): number {
  return generationDepth(id, ctx.ped, ctx.depth, new Set());
}

/**
 * Parentesco (kinship) entre dos animales: la probabilidad de que un alelo tomado al azar de cada
 * uno sea idéntico por descendencia.
 */
function kinship(a: string | null, b: string | null, ctx: Contexto): number {
  if (a === null || b === null) return 0;
  if (!ctx.ped.has(a) || !ctx.ped.has(b)) return 0;

  // La clave es simétrica: f(a,b) = f(b,a), así que se cachea una sola vez.
  const clave = a < b ? `${a}|${b}` : `${b}|${a}`;
  const cache = ctx.kin.get(clave);
  if (cache !== undefined) return cache;
  if (ctx.enCurso.has(clave)) return 0; // pedigrí que se muerde la cola: se corta acá

  ctx.enCurso.add(clave);
  let r: number;
  if (a === b) {
    const n = ctx.ped.get(a)!;
    r = 0.5 * (1 + kinship(n.sireId, n.damId, ctx));
  } else {
    // Se expande SIEMPRE al más profundo: garantiza que la recursión avanza hacia las raíces del
    // pedigrí y termina. Con profundidades iguales ninguno puede ser ancestro del otro, así que
    // expandir cualquiera es correcto.
    const [x, y] = profundidad(a, ctx) >= profundidad(b, ctx) ? [a, b] : [b, a];
    const n = ctx.ped.get(x)!;
    r = 0.5 * (kinship(n.sireId, y, ctx) + kinship(n.damId, y, ctx));
  }

  ctx.enCurso.delete(clave);
  ctx.kin.set(clave, r);
  return r;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * F de la CRÍA que saldría de aparear a estos dos. Es el número que hay que mirar ANTES de servir.
 *
 * Devuelve una fracción (0,125 = 12,5%), no un porcentaje: el redondeo a porcentaje es cosa de la
 * pantalla, y guardar el número crudo permite cambiar el umbral sin recalcular nada.
 */
export function matingInbreeding(sireId: string, damId: string, ped: Pedigree): number {
  return round4(kinship(sireId, damId, { ped, kin: new Map(), depth: new Map(), enCurso: new Set() }));
}

/** F de un animal que YA existe: el parentesco entre sus propios padres. */
export function animalInbreeding(animalId: string, ped: Pedigree): number {
  const n = ped.get(animalId);
  if (!n) return 0;
  return round4(kinship(n.sireId, n.damId, { ped, kin: new Map(), depth: new Map(), enCurso: new Set() }));
}

/**
 * Cuán grave es un F.
 *
 * Los cortes no son arbitrarios: caen sobre parentescos que el productor reconoce. 12,5% es medios
 * hermanos —y también abuelo × nieta—, el punto donde la práctica dice que no conviene seguir.
 * 6,25% son primos hermanos, normal en un rodeo cerrado pero digno de mirar. Por eso el bloqueo
 * por defecto está en 12,5% y no más abajo: prohibir por debajo de eso haría imposible trabajar
 * en una finca que no compra genética todos los años.
 */
export type InbreedingLevel = 'none' | 'low' | 'moderate' | 'high';

/** F ≥ este valor: no conviene aparear. Medios hermanos, abuelo × nieta y todo lo más cercano. */
export const INBREEDING_BLOCK_THRESHOLD = 0.125;

export function inbreedingLevel(f: number, umbral: number = INBREEDING_BLOCK_THRESHOLD): InbreedingLevel {
  if (!(f > 0)) return 'none';
  if (f >= umbral) return 'high';
  if (f >= umbral / 2) return 'moderate';
  return 'low';
}

/** Cómo se llama en castellano lo que se encontró, para que el aviso diga algo y no solo un número. */
export function describeInbreeding(f: number): string {
  const pct = round4(f) * 100;
  if (!(f > 0)) return 'Sin parentesco conocido';
  if (f >= 0.25) return `Parentesco muy cercano (${pct.toFixed(1)}%): padre/hija o hermanos enteros`;
  if (f >= 0.125) return `Parentesco cercano (${pct.toFixed(1)}%): medios hermanos o abuelo/nieta`;
  if (f >= 0.0625) return `Parentesco moderado (${pct.toFixed(1)}%): del orden de primos hermanos`;
  return `Parentesco lejano (${pct.toFixed(2)}%)`;
}
