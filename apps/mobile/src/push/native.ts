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
