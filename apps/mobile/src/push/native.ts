/**
 * Envoltorio NATIVO del registro de push (F2.a): provee las deps reales de `registerPushToken`
 * usando expo-notifications + expo-constants. Aísla aquí todo lo que toca el SO para que la
 * orquestación (registration.ts) siga siendo pura y testeable. No contiene credenciales.
 *
 * `activatePush` es la acción CONTEXTUAL del usuario («Activar notificaciones» en el Menú): pide
 * permiso con prompt del SO. La reconciliación en boot (permiso check-only) y los listeners de
 * recepción/rotación se cablean en F2.b.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushToken, permissionGranted, type PushRegistrationStatus, type RegisterPushDeps } from './registration';

const CHANNEL_ID = 'default';

/** projectId de EAS desde la config (no secreto). null si no está configurado → 'missing-project-id'. */
export function getProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Flag de push del cliente; se desactiva explícitamente con EXPO_PUBLIC_PUSH_ENABLED=false. */
export function pushEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PUSH_ENABLED !== 'false';
}

/**
 * ¿La plataforma tiene notificaciones nativas? En web NO: `expo-notifications` expone el módulo
 * pero varios métodos lanzan «is not available on web».
 *
 * Importa porque el harness de verificación en navegador (`npm run mobile`, react-native-web) es
 * parte del flujo de trabajo del repo, y `PushBridge` se monta siempre: sin esta guarda, la app
 * **crashea al arrancar** en web y no se puede verificar ninguna pantalla. Mismo criterio que
 * `ensureAndroidChannel`, que ya es no-op fuera de Android: la plataforma se conoce acá, no en
 * cada consumidor.
 */
export function pushSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Suscripción inerte para las plataformas sin push: el consumidor llama `.remove()` igual. */
const NOOP_SUBSCRIPTION: Subscription = { remove: () => {} } as Subscription;

/** Canal Android: DEBE existir antes de pedir permiso u obtener token (Android 13+). No-op en iOS. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Permiso con prompt (acción del usuario): si ya está concedido no re-prompta. */
async function requestPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (permissionGranted(existing)) return true;
  return permissionGranted(await Notifications.requestPermissionsAsync());
}

/** Permiso check-only (reconciliación en boot): nunca prompta. */
export async function checkPermission(): Promise<boolean> {
  return permissionGranted(await Notifications.getPermissionsAsync());
}

async function getExpoToken(projectId: string): Promise<string> {
  const res = await Notifications.getExpoPushTokenAsync({ projectId });
  return res.data;
}

/** Log de desarrollo NO sensible (estado tipado, sin token ni PII). */
export function logPush(context: string, status: PushRegistrationStatus): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[push] ${context}: ${status}`);
}

/** Puente con SyncContext: lo que la capa nativa necesita del estado autenticado. */
export interface PushSyncBridge {
  hasServerDevice: () => boolean;
  lastSyncedToken: () => string | undefined | null;
  syncToken: (token: string) => Promise<void>;
}

function deps(bridge: PushSyncBridge, ensurePermission: () => Promise<boolean>): RegisterPushDeps {
  return {
    enabled: pushEnabled(),
    projectId: getProjectId(),
    hasServerDevice: bridge.hasServerDevice,
    ensureAndroidChannel,
    ensurePermission,
    getExpoToken,
    lastSyncedToken: bridge.lastSyncedToken,
    syncToken: bridge.syncToken,
  };
}

/** Acción contextual del usuario: pide permiso (prompt) y registra/sincroniza el token Expo. */
export async function activatePush(bridge: PushSyncBridge): Promise<PushRegistrationStatus> {
  const status = await registerPushToken(deps(bridge, requestPermission));
  logPush('activate', status);
  return status;
}

/**
 * Reconciliación (boot / rotación): permiso CHECK-ONLY (sin prompt) + re-obtención y sync del token
 * Expo si cambió. Reutiliza la orquestación pura; no molesta al usuario si nunca activó el permiso.
 */
export async function reconcilePush(bridge: PushSyncBridge): Promise<PushRegistrationStatus> {
  const status = await registerPushToken(deps(bridge, checkPermission));
  logPush('reconcile', status);
  return status;
}

type Subscription = { remove: () => void };

/** Handler de foreground (una sola vez): banner + lista, sin sonido ni badge del SO. */
let handlerConfigured = false;
export function configureForegroundHandler(): void {
  if (!pushSupported()) return;
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Notificación recibida en foreground → señal para refrescar el feed (el caller la debouncea). */
export function addReceivedListener(cb: () => void): Subscription {
  if (!pushSupported()) return NOOP_SUBSCRIPTION;
  return Notifications.addNotificationReceivedListener(() => cb());
}

/** Respuesta (tap) → entrega el `data` crudo + identificador (para deduplicar con el cold start). */
export function addResponseListener(cb: (data: unknown, id: string) => void): Subscription {
  if (!pushSupported()) return NOOP_SUBSCRIPTION;
  return Notifications.addNotificationResponseReceivedListener((res) =>
    cb(res.notification.request.content.data, res.notification.request.identifier),
  );
}

/** Respuesta que abrió la app en frío (o null). Mismo shape que el listener para reusar el handler. */
export async function getInitialResponse(): Promise<{ data: unknown; id: string } | null> {
  if (!pushSupported()) return null;
  const res = await Notifications.getLastNotificationResponseAsync();
  if (!res) return null;
  return { data: res.notification.request.content.data, id: res.notification.request.identifier };
}

/**
 * Rotación del token (corrección D2): addPushTokenListener entrega el token NATIVO (APNs/FCM), NO
 * el Expo. Se usa solo como SEÑAL para re-ejecutar getExpoPushTokenAsync y sincronizar el token
 * Expo (vía reconcilePush). El caller debe desmontar la suscripción en su cleanup.
 */
export function subscribeTokenRotation(bridge: PushSyncBridge): Subscription {
  return Notifications.addPushTokenListener(() => {
    void reconcilePush(bridge);
  });
}
