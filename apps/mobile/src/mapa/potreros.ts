/**
 * Los potreros en el teléfono.
 *
 * Vienen de `GET /paddocks` y se guardan tal cual: un mapa que necesita señal para dibujarse no
 * sirve en el campo, que es el único lugar donde alguien lo mira. Se refresca al abrir la pestaña
 * y, si no hay conexión, se muestra lo último que bajó con la fecha a la vista — un potrero
 * vacío dibujado como lleno es peor que un mapa que avisa que está viejo.
 *
 * No pasa por el motor de sincronización: es lectura derivada del servidor, sin edición desde el
 * móvil. Mismo criterio que la agenda y el feed de notificaciones.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LoteEnPotrero {
  id: string;
  name: string;
  purpose: string | null;
  animal_count: number;
}

export interface Potrero {
  id: string;
  name: string;
  /** GeoJSON Polygon en unidades del lienzo (ver `encuadre`). `null` = potrero sin dibujar. */
  boundary: { type: string; coordinates: number[][][] } | null;
  area_ha: number | null;
  pasture_type: string | null;
  animal_count: number;
  /** Animales por hectárea, derivado por el servidor. `null` sin superficie. */
  stocking_rate: number | null;
  lots: LoteEnPotrero[];
}

export interface CachePotreros {
  potreros: Potrero[];
  /** Cuándo bajaron, ISO. */
  en: string;
}

const CLAVE = 'cowinance.potreros.v1';

export async function leerPotreros(): Promise<CachePotreros | null> {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    if (!crudo) return null;
    const parsed = JSON.parse(crudo) as CachePotreros;
    return Array.isArray(parsed?.potreros) ? parsed : null;
  } catch {
    return null;
  }
}

export async function guardarPotreros(potreros: Potrero[], en = new Date().toISOString()): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE, JSON.stringify({ potreros, en } satisfies CachePotreros));
  } catch {
    /* best-effort: sin caché el mapa sigue andando con señal */
  }
}

/** El anillo exterior de un potrero, o `null` si no está dibujado. */
export function anilloDe(p: Potrero): number[][] | null {
  const anillo = p.boundary?.coordinates?.[0];
  return Array.isArray(anillo) && anillo.length >= 3 ? anillo : null;
}

/**
 * Cuánta presión tiene un potrero COMPARADO CON LOS DEMÁS DE ESTE CAMPO.
 *
 * La primera versión usaba cortes absolutos —menos de 1 an/ha holgado, más de 2 cargado— y con
 * los datos reales los seis potreros caían en la misma banda: el mapa quedaba de un solo color y
 * no informaba nada. El problema de fondo es que esos cortes eran agronomía inventada: la carga
 * razonable depende del sistema, del clima y de la pastura, y un número fijo en el código iba a
 * estar mal para casi todo el mundo.
 *
 * La escala relativa no afirma qué carga es «buena» —eso no le toca a la app— y sí contesta la
 * pregunta que se hace alguien con un lote para mover: cuál de MIS potreros está más aliviado. El
 * número exacto está igual en el detalle, para quien sí sepa qué significa.
 *
 * Con todos los potreros en el mismo valor devuelve `uniforme` para todos: pintar diferencias
 * donde no las hay sería inventarlas.
 */
export type Carga = 'sin-datos' | 'uniforme' | 'menos' | 'medio' | 'mas';

export function clasificarPorCarga(potreros: readonly Potrero[]): Record<string, Carga> {
  const valores = potreros.map((p) => p.stocking_rate).filter((v): v is number => v != null && Number.isFinite(v));
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const hayDiferencia = valores.length > 0 && max > min;
  const primerCorte = min + (max - min) / 3;
  const segundoCorte = min + ((max - min) * 2) / 3;

  const salida: Record<string, Carga> = {};
  for (const p of potreros) {
    if (p.stocking_rate == null || !Number.isFinite(p.stocking_rate)) salida[p.id] = 'sin-datos';
    else if (!hayDiferencia) salida[p.id] = 'uniforme';
    else if (p.stocking_rate <= primerCorte) salida[p.id] = 'menos';
    else if (p.stocking_rate <= segundoCorte) salida[p.id] = 'medio';
    else salida[p.id] = 'mas';
  }
  return salida;
}
