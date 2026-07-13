import { notificationHref } from '../sync/notification-nav';

/**
 * Resolución del destino de un push (P7 F2.b), pura y ÚNICA: valida el payload del `data`
 * (contrato F2.c) y reutiliza `notificationHref`, con fallback centralizado a `/notificaciones`.
 * Nunca devuelve null: cualquier payload inválido/incompleto/no soportado o de otra versión cae al
 * feed. No duplica el mapeo de rutas (vive en notification-nav).
 *
 * Acoplamiento consciente: `SUPPORTED_PUSH_DATA_VERSION` debe subir junto con `PUSH_DATA_VERSION`
 * del backend (docs/reference/push-payload-contract.md).
 */
export const SUPPORTED_PUSH_DATA_VERSION = 1;

const FALLBACK = '/notificaciones';

export function resolvePushDestination(data: unknown): string {
  if (!data || typeof data !== 'object') return FALLBACK;
  const d = data as Record<string, unknown>;
  if (d.v !== SUPPORTED_PUSH_DATA_VERSION) return FALLBACK;
  if (typeof d.notificationId !== 'string' || d.notificationId.length === 0) return FALLBACK;
  const relatedType = typeof d.relatedType === 'string' ? d.relatedType : null;
  const relatedId = typeof d.relatedId === 'string' ? d.relatedId : null;
  return notificationHref({ related_type: relatedType, related_id: relatedId }) ?? FALLBACK;
}
