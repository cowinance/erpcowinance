import { describe, expect, it } from 'vitest';
import { parsePushEnabled } from './push-runtime-config';
import { buildPushTransport } from './push-transport.factory';
import { DisabledPushTransport } from './disabled-push-transport';
import { ExpoPushTransport } from './expo-push-transport';

/**
 * Unit del parser/factory de push (P7-3.c.2): la config es la fuente única de habilitación y
 * el provider efectivo se resuelve sin fallback silencioso. Boot seguro verificable sin arrancar
 * Nest ni llamar a Expo (el adapter no hace red al construirse).
 */
describe('push runtime config + transport factory', () => {
  it('parsePushEnabled: ausente/vacío/false → false; true → true', () => {
    expect(parsePushEnabled(undefined)).toBe(false);
    expect(parsePushEnabled('')).toBe(false);
    expect(parsePushEnabled('false')).toBe(false);
    expect(parsePushEnabled('true')).toBe(true);
  });

  it('parsePushEnabled: valor malformado → error de configuración (boot falla)', () => {
    expect(() => parsePushEnabled('foo')).toThrow(/PUSH_ENABLED/);
    expect(() => parsePushEnabled('1')).toThrow(/PUSH_ENABLED/);
  });

  it('deshabilitado → DisabledPushTransport', () => {
    expect(buildPushTransport(false)).toBeInstanceOf(DisabledPushTransport);
    expect(buildPushTransport(false, 'tok')).toBeInstanceOf(DisabledPushTransport);
  });

  it('habilitado → ExpoPushTransport (sin fallback silencioso), con o sin access token', () => {
    expect(buildPushTransport(true)).toBeInstanceOf(ExpoPushTransport); // access token ausente = config válida
    expect(buildPushTransport(true, '')).toBeInstanceOf(ExpoPushTransport); // vacío = como ausente
    expect(buildPushTransport(true, 'secret')).toBeInstanceOf(ExpoPushTransport);
  });
});
