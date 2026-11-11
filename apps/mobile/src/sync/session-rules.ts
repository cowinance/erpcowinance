/**
 * Las dos decisiones que pueden costar el trabajo del día.
 *
 * El store local es propiedad de `(userId, tenantId)`: el backend rechaza con 404 un `device_id`
 * de otro tenant, así que entrar con otra cuenta —o cambiar de finca— obliga a descartar la base
 * y bootstrapear de nuevo. Si en esa base había capturas sin subir, no se pueden enviar bajo la
 * cuenta nueva ni descartar en silencio: hay que bloquear y decir cuántas son.
 *
 * Vivían dentro del provider, mezcladas con fetches y estado de React, y por eso nunca se
 * probaron. Son reglas puras: dado quién entra y cuánto hay en cola, qué corresponde hacer.
 *
 * El conteo de pendientes llega como FUNCIÓN y no como número porque contar implica restaurar el
 * store del dueño previo desde el disco. Cuando el resultado no puede cambiar la decisión —misma
 * cuenta, misma finca, finca inexistente— no se paga ese costo, y los tests lo verifican.
 */

/** Qué hacer con el store local ante un cambio de identidad. */
export type DecisionDeSesion =
  /** No se cambia: hay trabajo sin subir que se perdería. `mensaje` es lo que lee la persona. */
  | { accion: 'bloquear'; mensaje: string }
  /** Seguir sin tocar nada: misma cuenta y misma finca, o no había base que descartar. */
  | { accion: 'seguir' }
  /** Descartar la base local y bootstrapear: la identidad cambió y no hay nada pendiente. */
  | { accion: 'descartar' };

type ContarPendientes = () => Promise<number>;

function cambios(n: number): string {
  return `${n} ${n === 1 ? 'cambio' : 'cambios'}`;
}

/**
 * Ingreso con una cuenta distinta de la dueña del store.
 *
 * `mismoDueno` compara usuario Y finca: el mismo usuario entrando a otra finca también cambia de
 * dataset. Sin store previo no hay nada que proteger ni que descartar.
 */
export async function decidirIngreso(args: {
  storeExistente: boolean;
  mismoDueno: boolean;
  contarPendientes: ContarPendientes;
}): Promise<DecisionDeSesion> {
  if (!args.storeExistente || args.mismoDueno) return { accion: 'seguir' };
  const pendientes = await args.contarPendientes();
  if (pendientes > 0) {
    return {
      accion: 'bloquear',
      mensaje: `Este dispositivo tiene ${cambios(pendientes)} sin sincronizar de otra cuenta. Ingresá con esa cuenta y sincronizá (o reiniciá la base local desde el Menú) antes de cambiar de usuario.`,
    };
  }
  return { accion: 'descartar' };
}

/**
 * Cambio de finca sin volver a pedir la contraseña.
 *
 * En el móvil esto NO es cambiar un token como en la web: es cambiar el dataset entero, y en un
 * teléfono en el campo eso puede ser varios minutos y muchos megas. De ahí que se bloquee con
 * pendientes, y que la finca de destino tenga que estar en la lista de la persona — el servidor
 * también lo valida, pero contestar sin señal evita un viaje perdido.
 */
export async function decidirCambioDeFinca(args: {
  organizaciones: { tenant_id: string }[];
  fincaActual: string | undefined;
  destino: string;
  contarPendientes: ContarPendientes;
}): Promise<DecisionDeSesion> {
  if (!args.organizaciones.some((o) => o.tenant_id === args.destino)) {
    return { accion: 'bloquear', mensaje: 'No tenés acceso a esa finca.' };
  }
  if (args.destino === args.fincaActual) return { accion: 'seguir' };
  const pendientes = await args.contarPendientes();
  if (pendientes > 0) {
    return {
      accion: 'bloquear',
      mensaje: `Tenés ${cambios(pendientes)} sin sincronizar. Sincronizá antes de cambiar de finca: no se pueden subir desde otra.`,
    };
  }
  return { accion: 'descartar' };
}
