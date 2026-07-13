/**
 * Cache local del feed de notificaciones in_app (P7-4.c.1). Todo aquí es PURO y sin I/O:
 * tipos, hidratación tolerante, reconciliación del read-set persistido y el reductor de
 * `refreshNotifications`. La orquestación de red vive en SyncContext; esta capa fija los
 * invariantes y entra al gate de Vitest móvil (igual que capture-builders, P5-2).
 *
 * Límite deliberado (espejo del endpoint): solo el feed in_app. NUNCA se modela ni persiste
 * información de entrega por dispositivo (deliveries, tokens, canal push, estados
 * queued/sent/failed ni nada del transporte). Ese límite se conserva también en los tipos.
 */

/** DTO local del feed in_app: exactamente los campos que devuelve GET /notifications. */
export interface CachedNotification {
  id: string;
  title: string;
  body: string | null;
  status: 'delivered' | 'read';
  read_at: string | null;
  created_at: string;
  alert_id: string | null;
  related_type: string | null;
  related_id: string | null;
}

/** Estado cacheado de notificaciones dentro de PersistedMeta (arreglos serializables, no Set). */
export interface NotificationCacheState {
  notifications: CachedNotification[];
  notificationsAt?: string;
  notificationReadPending: string[];
}

/** Resultado de un intento de refresh (inyectado por SyncContext tras la red). */
export interface RefreshOutcome {
  /** ids cuyo POST /read se resolvió como confirmado (2xx) o 404 (gone) → podar. */
  postedResolved: string[];
  /** feed nuevo de GET /notifications, o null si el fetch falló (se conserva el previo). */
  snapshot: CachedNotification[] | null;
  /** timestamp del refresh, inyectado (determinismo en tests). */
  nowIso: string;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const nullableString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Normaliza un read-set persistido: descarta vacíos/no-strings y deduplica preservando orden. */
export function normalizeReadPending(ids: readonly unknown[] | undefined | null): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!isNonEmptyString(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Agrega un id al read-set (normalizado). Base de la marca optimista local. */
export function addReadPending(pending: readonly unknown[] | undefined | null, id: string): string[] {
  if (!isNonEmptyString(id)) return normalizeReadPending(pending);
  return normalizeReadPending([...(Array.isArray(pending) ? pending : []), id]);
}

/**
 * Hidrata un snapshot crudo (JSON del endpoint o de un meta previo) a CachedNotification[]:
 * conserva solo los campos in_app, descarta ítems sin id, tolera campos nuevos o ausentes y
 * mantiene compatibilidad hacia atrás. Cualquier `status` desconocido cae a 'delivered'.
 */
export function hydrateCachedNotifications(raw: unknown): CachedNotification[] {
  if (!Array.isArray(raw)) return [];
  const out: CachedNotification[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (!isNonEmptyString(o.id)) continue;
    out.push({
      id: o.id,
      title: typeof o.title === 'string' ? o.title : '',
      body: nullableString(o.body),
      status: o.status === 'read' ? 'read' : 'delivered',
      read_at: nullableString(o.read_at),
      created_at: typeof o.created_at === 'string' ? o.created_at : '',
      alert_id: nullableString(o.alert_id),
      related_type: nullableString(o.related_type),
      related_id: nullableString(o.related_id),
    });
  }
  return out;
}

/** Milisegundos de un ISO tolerando fechas inválidas (→ -Infinity, ordenan al final en DESC). */
function timeMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Ordena por created_at descendente sin mutar; fechas inválidas van al final. */
export function sortByCreatedDesc(list: readonly CachedNotification[]): CachedNotification[] {
  return [...list].sort((a, b) => timeMs(b.created_at) - timeMs(a.created_at));
}

/**
 * Vista reconciliada (única fuente de verdad para pantalla y badge): aplica el read-set
 * pendiente (status→'read') sobre el snapshot y ordena por fecha desc. No muta el snapshot.
 */
export function reconcileView(
  snapshot: readonly CachedNotification[] | undefined | null,
  pending: readonly unknown[] | undefined | null,
): CachedNotification[] {
  const read = new Set(normalizeReadPending(pending));
  const applied = (snapshot ?? []).map((n) => (read.has(n.id) && n.status !== 'read' ? { ...n, status: 'read' as const } : n));
  return sortByCreatedDesc(applied);
}

/** Conteo de no leídas sobre una vista ya reconciliada (misma fuente que reconcileView). */
export function countUnread(view: readonly CachedNotification[]): number {
  return view.reduce((acc, n) => (n.status === 'read' ? acc : acc + 1), 0);
}

/** Clasifica la respuesta de POST /read. `null` = error de red/timeout (sin status). */
export function classifyReadPost(status: number | null | undefined): 'confirmed' | 'gone' | 'pending' {
  if (typeof status === 'number' && status >= 200 && status < 300) return 'confirmed';
  if (status === 404) return 'gone';
  return 'pending';
}

/**
 * Poda el read-set pendiente: elimina los `resolved` (POST confirmado o 404) y los ids que el
 * snapshot ya devuelve como `read`; conserva el resto (sin confirmación). Idempotente y acotado.
 */
export function prunePending(args: {
  pending: readonly unknown[] | undefined | null;
  resolved: readonly string[];
  snapshot: readonly CachedNotification[] | undefined | null;
}): string[] {
  const resolved = new Set(args.resolved);
  const readOnServer = new Set((args.snapshot ?? []).filter((n) => n.status === 'read').map((n) => n.id));
  return normalizeReadPending(args.pending).filter((id) => !resolved.has(id) && !readOnServer.has(id));
}

/**
 * Reductor puro de un refresh (D4): conserva el snapshot/timestamp previos si no llegó un feed
 * nuevo (fetch fallido) y poda el read-set por confirmaciones y por lo que el snapshot marca
 * read. Nunca sustituye el cache por [] ante un error de red.
 */
export function reduceRefresh(prev: NotificationCacheState, outcome: RefreshOutcome): NotificationCacheState {
  const gotFeed = outcome.snapshot !== null;
  const notifications = gotFeed ? hydrateCachedNotifications(outcome.snapshot) : prev.notifications;
  const notificationsAt = gotFeed ? outcome.nowIso : prev.notificationsAt;
  const notificationReadPending = prunePending({
    pending: prev.notificationReadPending,
    resolved: outcome.postedResolved,
    snapshot: notifications,
  });
  return { notifications, notificationsAt, notificationReadPending };
}
