/**
 * Encuadre del mapa de potreros.
 *
 * Los potreros se dibujan en el MISMO espacio que el editor de la web: un lienzo de 1000×700
 * unidades que representa ~3 km × 2,1 km (`METERS_PER_UNIT = 3` en el dominio). No hay proyección
 * geográfica ni tiles — es un esquema, y por eso funciona sin señal, que es el único modo que
 * importa en el campo.
 *
 * Lo único que agrega el móvil es el ENCUADRE: en una pantalla de teléfono, una finca que ocupa
 * una esquina del lienzo se vería como una mancha. Acá se calcula el recorte que la centra, sin
 * deformarla: se respeta la proporción del lienzo, así que un potrero cuadrado sigue cuadrado.
 *
 * Módulo puro, sin React ni Expo.
 */

/** El lienzo del editor. Cambiarlo acá sin cambiarlo en la web desalinea los dos mapas. */
export const LIENZO = { ancho: 1000, alto: 700 } as const;

/** Aire alrededor del contenido, como fracción del lado mayor. */
export const MARGEN = 0.08;

/** Lado mínimo del recorte: evita que un potrero diminuto se amplíe hasta verse como ruido. */
export const LADO_MINIMO = 80;

export interface Limites {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `Number(null)` es 0 y `Number('')` también, así que un vértice a medias —`[40, null]`— pasaría
 * por un punto legítimo en el origen y estiraría la caja hasta ahí. Se descarta antes de convertir.
 */
function coordenada(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(valor);
}

/** Caja que contiene a todos los anillos. `null` si no hay ni un vértice utilizable. */
export function limites(anillos: readonly (readonly number[][])[]): Limites | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const anillo of anillos) {
    for (const punto of anillo ?? []) {
      const x = coordenada(punto?.[0]);
      const y = coordenada(punto?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * `viewBox` que encuadra los potreros dibujados. Sin ninguno —finca sin mapear— devuelve el
 * lienzo entero, que es lo mismo que muestra la web.
 */
export function viewBoxQueEncuadra(anillos: readonly (readonly number[][])[]): string {
  const caja = limites(anillos);
  if (!caja) return `0 0 ${LIENZO.ancho} ${LIENZO.alto}`;

  const anchoContenido = caja.maxX - caja.minX;
  const altoContenido = caja.maxY - caja.minY;
  const aire = Math.max(anchoContenido, altoContenido, LADO_MINIMO) * MARGEN;

  // Se agranda el lado que haga falta para respetar la proporción del lienzo: así el recorte no
  // estira la figura. El otro queda con más aire, que es inofensivo.
  const proporcion = LIENZO.ancho / LIENZO.alto;
  let ancho = Math.max(anchoContenido + aire * 2, LADO_MINIMO);
  let alto = Math.max(altoContenido + aire * 2, LADO_MINIMO / proporcion);
  if (ancho / alto < proporcion) ancho = alto * proporcion;
  else alto = ancho / proporcion;

  const x = (caja.minX + caja.maxX) / 2 - ancho / 2;
  const y = (caja.minY + caja.maxY) / 2 - alto / 2;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(x)} ${r(y)} ${r(ancho)} ${r(alto)}`;
}

/** Centro de un anillo, para poner la etiqueta del potrero encima. */
export function centroide(anillo: readonly number[][]): { x: number; y: number } | null {
  const caja = limites([anillo]);
  if (!caja) return null;
  return { x: (caja.minX + caja.maxX) / 2, y: (caja.minY + caja.maxY) / 2 };
}

/** El anillo como atributo `points` de un `<Polygon>`. */
export function aPuntos(anillo: readonly number[][]): string {
  return anillo
    .filter((p) => Number.isFinite(coordenada(p?.[0])) && Number.isFinite(coordenada(p?.[1])))
    .map((p) => `${Number(p[0])},${Number(p[1])}`)
    .join(' ');
}
