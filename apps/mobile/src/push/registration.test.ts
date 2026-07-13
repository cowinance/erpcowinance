import { describe, it, expect, vi } from 'vitest';
import {
  type RegisterPushDeps,
  registerPushToken,
  shouldSyncToken,
  permissionGranted,
  pushStatusMessage,
} from './registration';

/**
 * Unit de la orquestación pura del registro de push (F2.a). Fija el flujo, el orden (canal antes
 * de permiso/token), la idempotencia local y los estados tipados, con TODAS las operaciones
 * nativas inyectadas como fakes. Ningún test toca Expo/RN.
 */
function deps(over: Partial<RegisterPushDeps> = {}): RegisterPushDeps {
  return {
    enabled: true,
    projectId: 'proj-1',
    hasServerDevice: () => true,
    ensureAndroidChannel: vi.fn(async () => {}),
    ensurePermission: vi.fn(async () => true),
    getExpoToken: vi.fn(async () => 'ExponentPushToken[abc]'),
    lastSyncedToken: () => undefined,
    syncToken: vi.fn(async () => {}),
    ...over,
  };
}

describe('registerPushToken — estados', () => {
  it('enabled=false → disabled, sin tocar nativo', async () => {
    const d = deps({ enabled: false });
    expect(await registerPushToken(d)).toBe('disabled');
    expect(d.ensureAndroidChannel).not.toHaveBeenCalled();
    expect(d.ensurePermission).not.toHaveBeenCalled();
  });

  it('sin projectId → missing-project-id, sin prompt', async () => {
    const d = deps({ projectId: null });
    expect(await registerPushToken(d)).toBe('missing-project-id');
    expect(d.ensurePermission).not.toHaveBeenCalled();
  });

  it('sin device registrado → error, sin prompt (no hay a quién asociar)', async () => {
    const d = deps({ hasServerDevice: () => false });
    expect(await registerPushToken(d)).toBe('error');
    expect(d.ensurePermission).not.toHaveBeenCalled();
  });

  it('permiso denegado → permission-denied, sin pedir token', async () => {
    const d = deps({ ensurePermission: vi.fn(async () => false) });
    expect(await registerPushToken(d)).toBe('permission-denied');
    expect(d.getExpoToken).not.toHaveBeenCalled();
  });

  it('camino feliz con token nuevo → registered + syncToken(token)', async () => {
    const d = deps();
    expect(await registerPushToken(d)).toBe('registered');
    expect(d.syncToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
  });

  it('token igual al último confirmado → registered pero NO re-sincroniza', async () => {
    const d = deps({ lastSyncedToken: () => 'ExponentPushToken[abc]' });
    expect(await registerPushToken(d)).toBe('registered');
    expect(d.syncToken).not.toHaveBeenCalled();
  });

  it('fallo al obtener token → error', async () => {
    const d = deps({ getExpoToken: vi.fn(async () => { throw new Error('red'); }) });
    expect(await registerPushToken(d)).toBe('error');
  });

  it('fallo al crear canal → error, sin pedir permiso ni token', async () => {
    const d = deps({ ensureAndroidChannel: vi.fn(async () => { throw new Error('canal'); }) });
    expect(await registerPushToken(d)).toBe('error');
    expect(d.ensurePermission).not.toHaveBeenCalled();
  });

  it('orden: el canal se crea ANTES de pedir permiso', async () => {
    const calls: string[] = [];
    const d = deps({
      ensureAndroidChannel: vi.fn(async () => { calls.push('channel'); }),
      ensurePermission: vi.fn(async () => { calls.push('permission'); return true; }),
      getExpoToken: vi.fn(async () => { calls.push('token'); return 'ExponentPushToken[x]'; }),
    });
    await registerPushToken(d);
    expect(calls).toEqual(['channel', 'permission', 'token']);
  });
});

describe('shouldSyncToken', () => {
  it('token vacío → false; cambiado → true; igual → false', () => {
    expect(shouldSyncToken('', undefined)).toBe(false);
    expect(shouldSyncToken('t1', undefined)).toBe(true);
    expect(shouldSyncToken('t2', 't1')).toBe(true);
    expect(shouldSyncToken('t1', 't1')).toBe(false);
  });
});

describe('permissionGranted', () => {
  it('granted=true → true; ios PROVISIONAL(3)/AUTHORIZED(2)/EPHEMERAL(4) → true; DENIED(1)/null → false', () => {
    expect(permissionGranted({ granted: true })).toBe(true);
    expect(permissionGranted({ granted: false, ios: { status: 3 } })).toBe(true);
    expect(permissionGranted({ ios: { status: 2 } })).toBe(true);
    expect(permissionGranted({ ios: { status: 4 } })).toBe(true);
    expect(permissionGranted({ granted: false, ios: { status: 1 } })).toBe(false);
    expect(permissionGranted(null)).toBe(false);
  });
});

describe('pushStatusMessage', () => {
  it('mensajes cubren todos los estados y no exponen token', () => {
    for (const s of ['idle', 'disabled', 'missing-project-id', 'permission-denied', 'registered', 'error'] as const) {
      expect(pushStatusMessage(s)).toBeTruthy();
    }
  });
});
