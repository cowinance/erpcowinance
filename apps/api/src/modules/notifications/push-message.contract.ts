/**
 * Contrato del payload `data` que viaja en el push (P7 F2.c). MÍNIMO, VERSIONADO y sin lógica de
 * navegación: el backend solo emite los datos; el cliente (móvil) resuelve el destino con su helper
 * (notificationHref) y aplica fallback a /notificaciones si el payload es inválido o incompleto.
 *
 * Convención del payload push = camelCase (coherente con `notificationId`, ya existente). El
 * snake_case (`related_type`/`related_id`) es solo de la DB/feed. Cualquier cambio de forma DEBE
 * subir `PUSH_DATA_VERSION` para que el cliente pueda validar/adaptar.
 */

export const PUSH_DATA_VERSION = 1;

// `type` (no interface) para que sea asignable a `Record<string, unknown>` del PushMessage.data.
export type PushMessageData = {
  /** Versión del contrato; el cliente acepta v===PUSH_DATA_VERSION y si no, cae al fallback. */
  v: number;
  notificationId: string;
  relatedType: string | null;
  relatedId: string | null;
};

/** Fila mínima de la notificación necesaria para construir el payload (null-safe). */
export interface PushMessageSource {
  id: string;
  related_type?: string | null;
  related_id?: string | null;
}

/** Construye el `data` del push desde la notificación. Puro; coerción null-safe; sin rutas. */
export function buildPushMessageData(n: PushMessageSource): PushMessageData {
  return {
    v: PUSH_DATA_VERSION,
    notificationId: n.id,
    relatedType: n.related_type ?? null,
    relatedId: n.related_id ?? null,
  };
}
