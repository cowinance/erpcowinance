import type { Capability } from '../../../common/permissions/capabilities';

/**
 * Nombres de tabla que participan del protocolo de sync — fuente única para
 * evitar typos al declarar `SyncHandler.table` o registrar un handler nuevo
 * (F6). No es el catálogo completo de las 140 tablas del schema, solo las
 * que hoy participan de sync (PutOp/EventOp) — se amplía a medida que un
 * módulo nuevo se suma al protocolo, no antes.
 */
export type SyncTable =
  | 'animals'
  | 'animal_movements'
  | 'mortalities'
  | 'pregnancies'
  | 'weighings'
  | 'weanings'
  | 'tasks'
  | 'animal_events'
  | 'vaccinations'
  | 'treatments'
  | 'breeding_events'
  | 'calvings'
  | 'calving_offspring';

/**
 * Qué capacidad hace falta para ESCRIBIR cada tabla por el canal de sync.
 *
 * ## Por qué esto tiene que existir
 *
 * El interceptor de permisos autoriza RUTAS, y `/sync/push` es una sola ruta bajo la capacidad
 * `sincronizacion` — que todos los roles tienen, porque el móvil no funciona sin ella. Adentro del
 * push viajan escrituras a trece tablas distintas, así que sin este mapa el canal de sync es un
 * agujero que esquiva la matriz entera: un veterinario recibía 403 en `PUT /animals/:id` y el mismo
 * cambio pasaba por sync sin que nada lo mirara.
 *
 * ## Por qué vive acá y no en `permissions/`
 *
 * Porque `SyncTable` es la fuente única de qué tablas participan del protocolo, y el permiso de
 * una tabla es parte de decidir que participa. Al lado, agregar una tabla obliga a elegir su
 * capacidad en el mismo commit; en otro archivo, se olvida — y olvidarse acá significa
 * exactamente el agujero de arriba. Un test recorre las claves y falla si falta alguna.
 *
 * `Record<SyncTable, …>` completo y sin índice opcional a propósito: TypeScript rechaza el archivo
 * si se suma un miembro a la unión sin su entrada.
 */
export const CAPACIDAD_DE_ESCRITURA: Record<SyncTable, Capability> = {
  // El animal y su movimiento.
  animals: 'hato',
  animal_events: 'hato', // la línea de tiempo se lee en la ficha del animal
  animal_movements: 'movimientos',
  weighings: 'pesajes',
  mortalities: 'mortandad',
  // Clínico: el operario APLICA lo que el veterinario indicó, y esta es la mitad que aplica.
  vaccinations: 'sanidad.aplicar',
  treatments: 'sanidad.aplicar',
  // Reproducción: lo captura el veterinario en el corral.
  pregnancies: 'reproduccion',
  weanings: 'reproduccion',
  breeding_events: 'reproduccion',
  calvings: 'reproduccion',
  calving_offspring: 'reproduccion',
  // Operación.
  tasks: 'tareas',
};

/**
 * Qué capacidad hace falta para RECIBIR cada tabla que el sync envía (bootstrap y pull).
 *
 * No alcanza con el mapa de escritura por dos motivos: el bootstrap manda además catálogos que no
 * participan del protocolo de escritura (`lots`, `products_veterinary`), y leer no siempre exige la
 * misma capacidad que escribir.
 *
 * El problema que cierra: `GET /animals` le devolvía 403 a un contador y el bootstrap le mandaba
 * 65 animales igual. El interceptor autoriza rutas, y esta es UNA ruta que transporta cinco tablas.
 *
 * `products_veterinary` va bajo `sanidad.aplicar` y NO bajo `sanidad.indicar`: el operario tiene
 * que ver el catálogo para registrar la vacuna que le indicaron, y pedirle `indicar` lo dejaría sin
 * poder cargar nada offline.
 */
export const CAPACIDAD_DE_LECTURA: Record<string, Capability> = {
  animals: 'hato',
  animal_events: 'hato',
  lots: 'hato',
  animal_movements: 'movimientos',
  weighings: 'pesajes',
  mortalities: 'mortandad',
  vaccinations: 'sanidad.aplicar',
  treatments: 'sanidad.aplicar',
  products_veterinary: 'sanidad.aplicar',
  pregnancies: 'reproduccion',
  weanings: 'reproduccion',
  breeding_events: 'reproduccion',
  calvings: 'reproduccion',
  calving_offspring: 'reproduccion',
  tasks: 'tareas',
};

/**
 * Tablas que el sync envía SIN filtrar, con su razón. Lo que no está acá ni en el mapa de arriba
 * se filtra por defecto — igual que las rutas, la omisión deniega en vez de permitir.
 *
 * Vacía hoy. Estuvo `pregnancies`, porque el operario no tenía `reproduccion` y el móvil muestra
 * el estado de preñez en la FICHA del animal (`app/animal/[id].tsx`), no solo en la captura
 * reproductiva: filtrarla le habría hecho decir «Vacía» a una vaca preñada, que es peor que
 * mostrar de más — la app le miente en el corral, que es donde se toma la decisión. Se resolvió
 * dándole al operario `reproduccion: 'read'` (ver `matrix.ts`), así que ya entra por el mapa.
 *
 * Se conserva la lista porque el conflicto va a repetirse: cada vez que el móvil muestre un dato
 * derivado de un módulo que ese rol no consulta, la salida es o ampliar la capacidad o
 * denormalizar el dato en la fila del animal, como ya se hizo con el retiro sanitario. Dejar la
 * tabla sin filtrar es el último recurso, y si se usa tiene que quedar escrito por qué.
 */
export const SIN_FILTRAR_AL_ENVIAR: readonly string[] = [];
