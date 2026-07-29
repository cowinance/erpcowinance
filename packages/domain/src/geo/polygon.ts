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
  if (seCruza(pts))
    throw new InvalidPolygonError('Los lados del potrero se cruzan. Revisá el orden de los puntos: el contorno tiene que poder recorrerse sin pasar dos veces por el mismo lugar');
  return pts;
}

/** Signo del producto cruzado: de qué lado de `a→b` cae `c`. 0 = alineados. */
function orientacion(a: number[], b: number[], c: number[]): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Con `p` alineado con `a→b`, ¿cae DENTRO del segmento? */
function enElSegmento(a: number[], b: number[], p: number[]): boolean {
  return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

function seCortan(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const d1 = orientacion(p3, p4, p1);
  const d2 = orientacion(p3, p4, p2);
  const d3 = orientacion(p1, p2, p3);
  const d4 = orientacion(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  // Casos alineados: un extremo apoyado sobre el otro segmento también es un cruce — el contorno se
  // pellizca y deja de encerrar una sola superficie.
  if (d1 === 0 && enElSegmento(p3, p4, p1)) return true;
  if (d2 === 0 && enElSegmento(p3, p4, p2)) return true;
  if (d3 === 0 && enElSegmento(p1, p2, p3)) return true;
  if (d4 === 0 && enElSegmento(p1, p2, p4)) return true;
  return false;
}

/**
 * ¿El contorno se cruza a sí mismo?
 *
 * Hace falta porque la fórmula del cordón NO se da cuenta: sobre un «moño» —los vértices tomados en
 * orden equivocado— las dos mitades tienen signo opuesto y se cancelan, así que devolvía 0 ha sin
 * una queja. Un potrero de 0 ha no tiene carga animal ni kg/ha calculables, y el productor no tenía
 * cómo saber que lo que estaba mal era el orden en que fue tocando los puntos.
 *
 * Se comparan los lados NO CONSECUTIVOS: los que comparten un vértice se tocan por definición, y el
 * primero con el último también, porque el contorno cierra. Es O(n²), y un potrero se dibuja con
 * unos pocos vértices.
 */
function seCruza(ring: Ring): boolean {
  const n = ring.length;
  if (n < 4) return false; // un triángulo no puede cruzarse
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adyacentes = j === i + 1 || (i === 0 && j === n - 1);
      if (adyacentes) continue;
      if (seCortan(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
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
  // Superficie nula: los puntos están todos sobre una misma recta. No es un potrero, es una línea —
  // y guardarlo dejaba una carga animal y unos kg/ha que no se pueden calcular nunca.
  if (ha <= 0) throw new InvalidPolygonError('El dibujo no encierra superficie: los puntos están alineados');
  return ha;
}

/** Construye el GeoJSON que se persiste en `boundary` (anillo abierto, como el resto del sistema). */
export function toPolygonGeoJSON(input: unknown): PolygonGeoJSON {
  return { type: 'Polygon', coordinates: [normalizePolygonRing(input)] };
}
