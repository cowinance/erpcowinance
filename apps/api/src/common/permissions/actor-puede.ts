import { requestContext } from '../request-context';
import { permite } from './matrix';
import type { Access, Capability } from './capabilities';

/**
 * ¿El actor de ESTA request tiene la capacidad? Para esconder CAMPOS, no rutas.
 *
 * ## Por qué hace falta algo además del interceptor
 *
 * El interceptor decide si una request pasa o no, y con eso alcanza para casi todo: una capacidad
 * es un conjunto de rutas. Pero `inventario.valuacion` no lo es. El costo unitario viaja como un
 * CAMPO dentro de respuestas que por lo demás son de existencias —`/inventory/items` trae
 * `standard_cost`, `/inventory/stock` trae `avg_cost`, `/inventory/movements` trae `unit_cost`—,
 * así que el veterinario, que necesita saber cuántas dosis quedan y cuándo vencen, recibía de
 * paso lo que cuesta cada una.
 *
 * Partir esas rutas en dos —una con costo y otra sin— habría sido peor: duplica el endpoint, la
 * consulta y la pantalla para esconder una columna.
 *
 * ## Sin contexto de request NO se esconde nada
 *
 * El seed, los jobs y los tests que construyen los servicios a mano corren sin `requestContext`.
 * Ahí no hay actor a quien restringirle nada, y devolver `false` convertiría a este helper en un
 * filtro silencioso sobre código interno de confianza — justo el tipo de cosa que después se
 * descubre porque un reporte da distinto según quién lo corra. Mismo criterio que
 * `isReadOnlySession()`, que también devuelve `false` cuando no hay sesión.
 *
 * **No es un control de seguridad de la ruta.** Eso lo hace `PermissionsInterceptor`. Esto decide
 * qué columnas viajan una vez que la ruta YA se autorizó.
 */
export function actorPuede(cap: Capability, access: Access = 'read'): boolean {
  const role = requestContext.getStore()?.role;
  if (!role) return true; // sin actor: proceso interno, no se filtra
  return permite(role, cap, access);
}

/**
 * Devuelve las filas sin los campos indicados cuando el actor no tiene la capacidad.
 *
 * Se borra la clave en lugar de ponerla en `null`: `null` significa «no hay costo cargado», que es
 * un estado real y distinto de «no te lo puedo mostrar». Una pantalla que muestre «—» por las dos
 * razones le miente al que mira.
 */
export function sinCamposSi<T extends Record<string, unknown>>(
  filas: T[],
  falta: Capability,
  campos: readonly string[],
): T[] {
  if (actorPuede(falta)) return filas;
  return filas.map((f) => {
    const copia = { ...f };
    for (const c of campos) delete copia[c];
    return copia;
  });
}
