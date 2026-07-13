import type { CachedNotification } from './notification-cache';

/**
 * Deep-link CERRADO del feed in_app (P7-4.c.2, D7): mapa fijo por `related_type`, nunca derivado
 * de title/body ni de datos libres. Puro y sin imports de Expo/RN → entra al gate de Vitest; la
 * pantalla castea el resultado a `Href`. Un ítem sin destino devuelve null (se marca leído y
 * permanece en pantalla, sin error de navegación).
 */
export function notificationHref(item: Pick<CachedNotification, 'related_type' | 'related_id'>): string | null {
  const { related_type, related_id } = item;
  if (related_type === 'animal' && related_id) return `/animal/${encodeURIComponent(related_id)}`;
  if (related_type === 'task') return '/tareas';
  return null;
}
