import type { Access, Capability } from './capabilities';

/**
 * Quién puede hacer qué. La matriz de permisos, COMO DATOS.
 *
 * ## Por qué datos y no `if`s repartidos
 *
 * Tres razones, en orden de importancia:
 *
 *  1. **Se puede leer entera de una sentada.** Un permiso disperso en veinte guards no se audita:
 *     la pregunta «¿qué ve un veterinario?» se contesta leyendo veinte archivos y confiando en no
 *     haber salteado ninguno.
 *  2. **Habilita roles a medida sin rehacer nada.** `roles.tenant_id` es nullable con
 *     `UNIQUE (tenant_id, code)`: el modelo ya permite que una finca defina el suyo. Si esto
 *     fueran constantes en el código, ese día habría que reescribirlo; siendo una tabla de datos,
 *     mover esto a la base es un cambio de fuente, no de diseño.
 *  3. **Se puede diffear.** Un cambio de permiso se ve en la revisión como lo que es: una celda
 *     que cambió.
 *
 * ## Cómo leerla
 *
 * Lo que NO figura, no se puede: se deniega por defecto. `write` implica `read` — no hace falta
 * declarar las dos. Ver `capabilities.ts` para qué rutas cubre cada capacidad.
 */
export type Role = 'owner' | 'admin' | 'veterinarian' | 'foreman' | 'worker' | 'accountant';

export const ROLES: Role[] = ['owner', 'admin', 'veterinarian', 'foreman', 'worker', 'accountant'];

type Permisos = Partial<Record<Capability, Access>>;

/**
 * Las tiene todo el mundo: su sesión, la pantalla de Inicio, sus alertas y el canal de sync.
 *
 * `inicio` está acá y no en cada rol por una regla que salió de romperla: **la pantalla con la que
 * abre la aplicación tiene que ser alcanzable por todos**. Estaba bajo `reportes`, que el operario
 * no tiene a propósito, y el móvil —donde el operario vive— no le arrancaba. Un permiso que deja a
 * un rol afuera de su propia puerta de entrada no está restringiendo: está rompiendo.
 */
const TRANSVERSALES: Permisos = {
  sesion: 'read',
  inicio: 'read',
  alertas: 'read',
  sincronizacion: 'write',
};

export const MATRIX: Record<Role, Permisos> = {
  /** El dueño puede todo. Un test verifica que no le falte ninguna capacidad nueva. */
  owner: {
    ...TRANSVERSALES,
    hato: 'write', pesajes: 'write', movimientos: 'write', mortandad: 'write',
    'sanidad.indicar': 'write', 'sanidad.aplicar': 'write', laboratorio: 'write',
    reproduccion: 'write', genetica: 'write',
    produccion: 'write', nutricion: 'write', campo: 'write', tareas: 'write',
    'inventario.existencias': 'write', 'inventario.valuacion': 'write',
    maquinaria: 'write', trazabilidad: 'write',
    comercial: 'write', finanzas: 'write', impuestos: 'write',
    'rrhh.parte': 'write', 'rrhh.liquidacion': 'write', 'rrhh.legajo': 'write',
    reportes: 'write', configuracion: 'write', usuarios: 'write', suscripcion: 'write',
  },

  /**
   * Gerencia la operación completa, incluido el dinero. La ÚNICA diferencia con el dueño es la
   * relación comercial con Cowinance: no toca la suscripción. Sí invita usuarios, con los dos
   * límites de `LIMITES_ADMIN`.
   */
  admin: {
    ...TRANSVERSALES,
    hato: 'write', pesajes: 'write', movimientos: 'write', mortandad: 'write',
    'sanidad.indicar': 'write', 'sanidad.aplicar': 'write', laboratorio: 'write',
    reproduccion: 'write', genetica: 'write',
    produccion: 'write', nutricion: 'write', campo: 'write', tareas: 'write',
    'inventario.existencias': 'write', 'inventario.valuacion': 'write',
    maquinaria: 'write', trazabilidad: 'write',
    comercial: 'write', finanzas: 'write', impuestos: 'write',
    'rrhh.parte': 'write', 'rrhh.liquidacion': 'write', 'rrhh.legajo': 'write',
    reportes: 'write', configuracion: 'write', usuarios: 'write',
  },

  /**
   * Manda en lo clínico y ve el hato entero. NO ve un solo número de plata — ni comercial, ni
   * finanzas, ni sueldos, ni el costo de lo que receta. Sí ve el stock: necesita saber cuántas
   * dosis quedan y cuándo vencen, que es `inventario.existencias` y no `valuacion`.
   */
  veterinarian: {
    ...TRANSVERSALES,
    hato: 'read', pesajes: 'read', movimientos: 'read', mortandad: 'write',
    'sanidad.indicar': 'write', 'sanidad.aplicar': 'write', laboratorio: 'write',
    reproduccion: 'write', genetica: 'write',
    produccion: 'read', nutricion: 'read', campo: 'read',
    tareas: 'write',
    'inventario.existencias': 'read',
    trazabilidad: 'read', reportes: 'read',
  },

  /**
   * Corre el día a día del campo. Ejecuta lo sanitario, no lo decide: aplica la dosis que el
   * veterinario indicó. Carga el parte de trabajo de su cuadrilla, pero no ve sueldos ni da altas.
   */
  foreman: {
    ...TRANSVERSALES,
    hato: 'write', pesajes: 'write', movimientos: 'write', mortandad: 'write',
    'sanidad.indicar': 'read', 'sanidad.aplicar': 'write', laboratorio: 'read',
    reproduccion: 'read', genetica: 'read',
    produccion: 'write', nutricion: 'write', campo: 'write', tareas: 'write',
    'inventario.existencias': 'write', maquinaria: 'write',
    trazabilidad: 'read', 'rrhh.parte': 'write', reportes: 'read',
  },

  /**
   * Captura en el corral, casi siempre desde el móvil y sin señal. Registra hechos; no consulta
   * ni configura. Su permiso de escritura es —a propósito— casi exactamente la lista de tablas
   * que participan del sync offline: si divergieran, el móvil guardaría algo que el servidor
   * después rechaza, y se enteraría al volver la señal con el trabajo del día ya hecho.
   */
  worker: {
    ...TRANSVERSALES,
    hato: 'write', pesajes: 'write', movimientos: 'write', mortandad: 'write',
    'sanidad.aplicar': 'write', tareas: 'write',
    produccion: 'write', nutricion: 'read', campo: 'read', maquinaria: 'read',
    /**
     * LEE reproducción, no la escribe (decisión 15 ago). Saber que una vaca está preñada cambia
     * cómo se la maneja en la manga, y el móvil lo muestra en la FICHA del animal —no solo en la
     * captura reproductiva—, así que sin esto la ficha le diría «Vacía» a una vaca preñada. Es el
     * mismo criterio por el que el retiro sanitario y los casos clínicos abiertos ya le llegan.
     *
     * Alcance real, para que no sorprenda: son 23 rutas de lectura, incluidas `reproduction/kpis`,
     * `reproduction/dashboard` y los reportes reproductivos. Se aceptó a sabiendas; la alternativa
     * angosta era mapear SOLO la tabla `pregnancies` del sync bajo `hato` y dejar el resto cerrado.
     */
    reproduccion: 'read',
  },

  /**
   * Manda en finanzas e impuestos. Ve cantidades y costos del rodeo para valuarlo; no entra a la
   * ficha de un animal ni a nada clínico. Lee el legajo porque lo necesita para liquidar.
   */
  accountant: {
    ...TRANSVERSALES,
    produccion: 'read',
    'inventario.existencias': 'read', 'inventario.valuacion': 'read',
    maquinaria: 'read', trazabilidad: 'read',
    comercial: 'read', finanzas: 'write', impuestos: 'write',
    'rrhh.parte': 'write', 'rrhh.liquidacion': 'write', 'rrhh.legajo': 'read',
    reportes: 'read',
  },
};

/**
 * Dos invariantes del alta de usuarios que NO son celdas de la matriz y por eso se olvidan.
 *
 * Sin la primera, un admin se promueve a dueño y la distinción entre los dos roles se evapora
 * sola. Sin la segunda, puede dejar al dueño afuera de su propia finca. Viven acá —y no dentro
 * del futuro módulo de invitaciones— para que se lean junto a la matriz, que es donde alguien
 * va a buscar «qué puede hacer un admin».
 */
export const LIMITES_ADMIN = {
  /** Roles que un `admin` NO puede otorgar al invitar. */
  noPuedeOtorgar: ['owner'] as Role[],
  /** Roles a los que un `admin` NO puede revocarle el acceso. */
  noPuedeRevocar: ['owner'] as Role[],
} as const;

/** ¿El rol tiene la capacidad con AL MENOS este nivel? `write` implica `read`. */
export function permite(role: string, cap: Capability, access: Access): boolean {
  const permisos = MATRIX[role as Role];
  if (!permisos) return false; // rol desconocido → denegado, sin excepciones
  const otorgado = permisos[cap];
  if (!otorgado) return false;
  return otorgado === 'write' || access === 'read';
}
