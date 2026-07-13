/**
 * Registro de push en el dispositivo (P7 Fase 2, F2.a) — capa PURA y sin dependencias de Expo/RN.
 * La orquestación recibe TODAS las operaciones nativas por inyección (`RegisterPushDeps`), de modo
 * que entra al gate de Vitest con fakes. El envoltorio nativo (native.ts) provee las deps reales.
 *
 * Estado tipado (decisión 2): distingue disabled / missing-project-id / permission-denied /
 * registered / error (+ idle inicial) sin exponer el token ni datos sensibles. El log de
 * desarrollo vive en el envoltorio nativo, no aquí (para mantener este módulo puro).
 */

export type PushRegistrationStatus =
  | 'idle'
  | 'disabled'
  | 'missing-project-id'
  | 'permission-denied'
  | 'registered'
  | 'error';

/** Forma mínima del permiso (subconjunto de NotificationPermissionsStatus) para no acoplar a Expo. */
export interface PermissionLike {
  granted?: boolean;
  ios?: { status?: number } | null;
}

/** iOS: AUTHORIZED(2), PROVISIONAL(3) y EPHEMERAL(4) cuentan como concedido; Android usa `granted`. */
export function permissionGranted(perm: PermissionLike | null | undefined): boolean {
  if (!perm) return false;
  if (perm.granted === true) return true;
  const s = perm.ios?.status;
  return s === 2 || s === 3 || s === 4;
}

/** Solo sincroniza si el token es no vacío y cambió respecto al último confirmado (idempotencia local). */
export function shouldSyncToken(token: string, last?: string | null): boolean {
  return !!token && token !== last;
}

export interface RegisterPushDeps {
  /** Flag de push del cliente (EXPO_PUBLIC_PUSH_ENABLED); false → 'disabled'. */
  enabled: boolean;
  /** projectId de EAS (Constants.expoConfig.extra.eas.projectId); null → 'missing-project-id'. */
  projectId: string | null;
  /** Debe existir un device registrado para asociar el token; si no, no se prompta. */
  hasServerDevice: () => boolean;
  /** Canal Android: DEBE crearse antes de pedir permiso u obtener el token (Android 13+). */
  ensureAndroidChannel: () => Promise<void>;
  /** Contextual: request (acción del usuario) o check-only (reconciliación en boot). true si concedido. */
  ensurePermission: () => Promise<boolean>;
  /** getExpoPushTokenAsync({ projectId }) → token Expo (NO el nativo APNs/FCM). */
  getExpoToken: (projectId: string) => Promise<string>;
  /** Último token confirmado con el servidor (optimización local, no la fuente de verdad). */
  lastSyncedToken: () => string | undefined | null;
  /** POST /sync/devices/:id/push-token + persistencia del último token confirmado. */
  syncToken: (token: string) => Promise<void>;
}

/**
 * Orquesta el registro/reconciliación del token Expo. Mismo flujo para «Activar» (permiso con
 * prompt) y «reconciliar en boot» (permiso check-only): cambia solo la `ensurePermission` inyectada.
 * Devuelve el estado tipado; nunca lanza.
 */
export async function registerPushToken(deps: RegisterPushDeps): Promise<PushRegistrationStatus> {
  if (!deps.enabled) return 'disabled';
  if (!deps.projectId) return 'missing-project-id';
  if (!deps.hasServerDevice()) return 'error'; // sin device no hay a quién asociar el token
  try {
    await deps.ensureAndroidChannel(); // canal ANTES del permiso/token
    const granted = await deps.ensurePermission();
    if (!granted) return 'permission-denied';
    const token = await deps.getExpoToken(deps.projectId);
    if (shouldSyncToken(token, deps.lastSyncedToken())) await deps.syncToken(token);
    return 'registered';
  } catch {
    return 'error';
  }
}

/** Mensaje corto y NO sensible para UI y log de desarrollo (sin token ni PII). */
export function pushStatusMessage(status: PushRegistrationStatus): string {
  switch (status) {
    case 'registered':
      return 'Notificaciones activadas';
    case 'permission-denied':
      return 'Permiso de notificaciones denegado';
    case 'missing-project-id':
      return 'Falta configurar el proyecto de notificaciones';
    case 'disabled':
      return 'Notificaciones push desactivadas';
    case 'error':
      return 'No se pudieron activar las notificaciones';
    case 'idle':
      return 'Notificaciones sin activar';
  }
}
