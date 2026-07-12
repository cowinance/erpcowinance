import type { PushTransport } from './push-transport.port';
import { DisabledPushTransport } from './disabled-push-transport';
import { ExpoPushTransport } from './expo-push-transport';

/**
 * Resuelve el ÚNICO transporte push efectivo (P7-3.c.2). Sin fallback silencioso: con
 * `enabled=true` el provider efectivo es SIEMPRE `ExpoPushTransport`; deshabilitado →
 * `DisabledPushTransport` (que lanza si se invoca). El adapter NO hace red al construirse.
 * `accessToken` es opcional (Expo lo permite): solo se pasa si existe y no está vacío.
 */
export function buildPushTransport(enabled: boolean, accessToken?: string): PushTransport {
  if (!enabled) return new DisabledPushTransport();
  return new ExpoPushTransport({ accessToken: accessToken && accessToken.length > 0 ? accessToken : undefined });
}
