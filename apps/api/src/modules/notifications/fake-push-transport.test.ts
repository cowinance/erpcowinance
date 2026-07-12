import { describe, expect, it } from 'vitest';
import { FakePushTransport } from './fake-push-transport';

/**
 * Unit del transporte falso (P7-3.a): por defecto ok; programable por token; `ref` se
 * preserva exactamente (independiente del orden); registra lo enviado. Habilita la
 * verificación headless del procesador (P7-3.b) sin red ni credenciales de Expo.
 */
describe('FakePushTransport', () => {
  const msg = (ref: string, token: string) => ({ ref, token, title: 't', body: 'b' });

  it('por defecto devuelve ok con el ref exacto de cada mensaje', async () => {
    const fake = new FakePushTransport();
    const res = await fake.send([msg('d1', 'tokA'), msg('d2', 'tokB')]);
    expect(res).toEqual([
      { ref: 'd1', ok: true, transient: false },
      { ref: 'd2', ok: true, transient: false },
    ]);
    expect(fake.sent.map((m) => m.ref)).toEqual(['d1', 'd2']);
  });

  it('programable por token: éxito + error transitorio + error permanente', async () => {
    const fake = new FakePushTransport();
    fake.program('tokB', { ok: false, error: 'MessageRateExceeded', transient: true });
    fake.program('tokC', { ok: false, error: 'DeviceNotRegistered', transient: false });
    const res = await fake.send([msg('d1', 'tokA'), msg('d2', 'tokB'), msg('d3', 'tokC')]);
    expect(res.find((r) => r.ref === 'd1')).toMatchObject({ ok: true });
    expect(res.find((r) => r.ref === 'd2')).toMatchObject({ ok: false, error: 'MessageRateExceeded', transient: true });
    expect(res.find((r) => r.ref === 'd3')).toMatchObject({ ok: false, error: 'DeviceNotRegistered', transient: false });
  });
});
