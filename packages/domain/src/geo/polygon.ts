/**
 * Geometría de potreros (D3 · Mapas y GPS). En producción `paddocks.boundary` es PostGIS
 * geography(Polygon) con coordenadas reales; en PGlite se degrada a jsonb con GeoJSON en unidades de
 * mapa local (el editor dibuja sobre un canvas esquemático que funciona offline, sin tiles). Estas
 * reglas validan el polígono y derivan su superficie (medición) por la fórmula del cordón (shoelace).
 *
 * El canvas del editor mide 1000×700 unidades y representa ~3 km × 2,1 km: `METERS_PER_UNIT = 3`. Así
 * el área derivada de un polígono dibujado cae en un rango realista de hectáreas.
 */
export const METERS_PER_UNIT = 3;

export class InvalidPolygonError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidPolygonError';
  }
}

export type Ring = number[][];
export interface PolygonGeoJSON {
  type: 'Polygon';
  coordinates: Ring[];
}

const isPoint = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));

/**
 * Normaliza la entrada (GeoJSON Polygon o un anillo `number[][]`) a un anillo ABIERTO de ≥3 vértices
 * distintos (sin el punto de cierre duplicado). Lanza `InvalidPolygonError` si no es un polígono válido.
 */
export function normalizePolygonRing(input: unknown): Ring {
  let ring: unknown;
  if (Array.isArray(input)) ring = input;
  else if (input && typeof input === 'object' && (input as PolygonGeoJSON).type === 'Polygon') {
    ring = (input as PolygonGeoJSON).coordinates?.[0];
  }
  if (!Array.isArray(ring)) throw new InvalidPolygonError('Se espera un polígono GeoJSON o un anillo de coordenadas');
  const pts = ring.filter(isPoint).map((p) => [Number(p[0]), Number(p[1])] as number[]);
  // Descarta el vértice de cierre si repite el primero (GeoJSON cerrado).
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  // Cuenta vértices distintos.
  const distinct = new Set(pts.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) throw new InvalidPolygonError('El potrero necesita al menos 3 vértices distintos');
  return pts;
}

/**
 * Techo de superficie de UN potrero, en hectáreas.
 *
 * No es una preferencia: un potrero de un millón de hectáreas son 10.000 km², más que la superficie
 * agrícola de países enteros y varias veces la estancia más grande del mundo. Si el cálculo da algo
 * así, lo que está mal no es el potrero — son las coordenadas, que vienen en otra escala (metros
 * proyectados donde se esperan unidades de mapa, o al revés).
 *
 * Hace falta porque el área DERIVADA iba directo a la base sin que nadie la mirara, y la columna es
 * `numeric(14,3)`: un polígono con coordenadas grandes devolvía 9×10¹⁴ ha y el endpoint se caía con
 * un 500 crudo. Un error de carga tiene que contestar qué está mal, no romperse.
 */
export const MAX_PADDOCK_HA = 1_000_000;

/**
 * Valida una superficie declarada a mano (potrero todavía sin dibujar).
 *
 * `null` es válido: significa «no la sé todavía», que es distinto de cero. Lo que no se acepta es un
 * número que no puede ser una superficie — negativo, cero o no numérico. Se aceptaba `-50`, y de ahí
 * salía una carga animal negativa; y un texto se guardaba como `null` en silencio, perdiendo el dato
 * sin decir que estaba mal escrito.
 */
export function validateDeclaredAreaHa(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidPolygonError('La superficie tiene que ser un número en hectáreas');
  if (n <= 0) throw new InvalidPolygonError('La superficie tiene que ser mayor que cero');
  if (n > MAX_PADDOCK_HA) throw new InvalidPolygonError(`Una superficie de ${n} ha no es de un potrero: revisá la unidad`);
  return n;
}

/** Superficie del polígono en hectáreas (shoelace, con la escala del canvas). */
export function polygonAreaHa(input: unknown): number {
  const ring = normalizePolygonRing(input);
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    acc += x1 * y2 - x2 * y1;
  }
  const areaUnits = Math.abs(acc) / 2;
  const areaM2 = areaUnits * METERS_PER_UNIT * METERS_PER_UNIT;
  const ha = Math.round((areaM2 / 10000) * 100) / 100;
  // El resultado se comprueba ACÁ y no en quien lo guarda: es el único lugar que sabe que el número
  // salió de una geometría, y por lo tanto el único que puede decir que el problema es la escala de
  // las coordenadas y no la superficie que alguien tipeó.
  if (!Number.isFinite(ha) || ha > MAX_PADDOCK_HA)
    throw new InvalidPolygonError('El dibujo da una superficie imposible para un potrero: revisá las coordenadas, parecen estar en otra escala');
  return ha;
}

/** Construye el GeoJSON que se persiste en `boundary` (anillo abierto, como el resto del sistema). */
export function toPolygonGeoJSON(input: unknown): PolygonGeoJSON {
  return { type: 'Polygon', coordinates: [normalizePolygonRing(input)] };
}
