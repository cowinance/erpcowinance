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
  return Math.round((areaM2 / 10000) * 100) / 100;
}

/** Construye el GeoJSON que se persiste en `boundary` (anillo abierto, como el resto del sistema). */
export function toPolygonGeoJSON(input: unknown): PolygonGeoJSON {
  return { type: 'Polygon', coordinates: [normalizePolygonRing(input)] };
}
