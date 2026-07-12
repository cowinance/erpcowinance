import { describe, expect, it, vi } from 'vitest';
import { ExpoPushTransport } from './expo-push-transport';
import { PushTransportRequestError } from './push-transport.port';

/**
 * Unit del ExpoPushTransport (P7-3.c.1) con `fetch` inyectado/mockeado — CERO red real.
 * Verifica: asociación por ref, batching ≤100, clasificación permanente/temporal,
 * PushTransportRequestError para fallos de request, prevalidación, timeout y headers.
 */
describe('ExpoPushTransport', () => {
  const tok = (n: string) => `ExponentPushToken[${n}]`;
  const msg = (ref: string, token = tok(ref), extra: Record<string, unknown> = {}) => ({ ref, token, title: 't', body: 'b', ...extra });
  // fetch que responde 200 con `data` = tickets provistos; captura las llamadas.
  const fetchTickets = (ticketsFor: (body: any[]) => any[], calls: any[] = []) =>
    vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ headers: init.headers, count: body.length });
      return { ok: true, status: 200, json: async () => ({ data: ticketsFor(body) }) } as any;
    });
  const okTickets = (body: any[]) => body.map((_, i) => ({ status: 'ok', id: `id-${i}` }));

  it('1. éxito conserva el ref', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets) });
    const r = await t.send([msg('d1')]);
    expect(r).toEqual([{ ref: 'd1', ok: true, transient: false }]);
  });

  it('2. múltiples mensajes conservan la asociación', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets((b) => b.map((_, i) => ({ status: 'ok', id: `id-${i}` }))) });
    const r = await t.send([msg('a'), msg('b'), msg('c')]);
    expect(r.map((x) => x.ref)).toEqual(['a', 'b', 'c']);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  it('3. más de 100 → sublotes', async () => {
    const calls: any[] = [];
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets, calls) });
    const many = Array.from({ length: 150 }, (_, i) => msg(`m${i}`));
    const r = await t.send(many);
    expect(r).toHaveLength(150);
    expect(calls.map((c) => c.count)).toEqual([100, 50]);
    expect(r[149].ref).toBe('m149');
  });

  it('4. DeviceNotRegistered → permanente', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(() => [{ status: 'error', details: { error: 'DeviceNotRegistered' } }]) });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ref: 'd1', ok: false, error: 'DeviceNotRegistered', transient: false });
  });

  it('5. MessageRateExceeded → temporal', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(() => [{ status: 'error', details: { error: 'MessageRateExceeded' } }]) });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ok: false, error: 'MessageRateExceeded', transient: true });
  });

  it('6. error individual desconocido → ProviderError + providerCode original, temporal', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(() => [{ status: 'error', details: { error: 'SomethingNew' } }]) });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ok: false, error: 'ProviderError', providerCode: 'SomethingNew', transient: true });
  });

  it('7. HTTP 429 → resultados individuales temporales (normalizado por sublote)', async () => {
    const t = new ExpoPushTransport({ fetchImpl: vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as any) });
    expect(await t.send([msg('d1'), msg('d2')])).toEqual([
      { ref: 'd1', ok: false, error: 'ProviderError', providerCode: 'http_429', transient: true },
      { ref: 'd2', ok: false, error: 'ProviderError', providerCode: 'http_429', transient: true },
    ]);
  });

  it('8. HTTP 500 → temporal individual', async () => {
    const t = new ExpoPushTransport({ fetchImpl: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as any) });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ok: false, providerCode: 'http_500', transient: true });
  });

  it('9. HTTP 400 → permanente individual (sin reintento), sin resultados fabricados por posición', async () => {
    const t = new ExpoPushTransport({ fetchImpl: vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ errors: [{ code: 'INVALID' }] }) }) as any) });
    const r = await t.send([msg('d1'), msg('d2')]);
    expect(r).toEqual([
      { ref: 'd1', ok: false, error: 'ProviderError', providerCode: 'http_400', transient: false },
      { ref: 'd2', ok: false, error: 'ProviderError', providerCode: 'http_400', transient: false },
    ]);
  });

  it('10. timeout/abort → temporal individual', async () => {
    const fetchHang = vi.fn((_url: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) as any);
    const t = new ExpoPushTransport({ fetchImpl: fetchHang as any, timeoutMs: 10 });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ok: false, providerCode: 'network_or_timeout', transient: true });
  });

  it('11. menos tickets → temporal explícito por cada mensaje faltante', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets((b) => b.slice(0, 1).map(() => ({ status: 'ok' }))) }); // 1 ticket para 2 mensajes
    const r = await t.send([msg('a'), msg('b')]);
    expect(r[0]).toMatchObject({ ref: 'a', ok: true });
    expect(r[1]).toMatchObject({ ref: 'b', ok: false, error: 'ProviderError', providerCode: 'provider_missing_result', transient: true });
  });

  it('12. tickets sobrantes no alteran asociaciones', async () => {
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(() => [{ status: 'ok' }, { status: 'ok' }, { status: 'ok' }]) }); // 3 tickets para 1 mensaje
    const r = await t.send([msg('a')]);
    expect(r).toEqual([{ ref: 'a', ok: true, transient: false }]);
  });

  it('13. JSON inválido → temporal individual', async () => {
    const t = new ExpoPushTransport({ fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) as any) });
    expect((await t.send([msg('d1')]))[0]).toMatchObject({ ok: false, providerCode: 'invalid_json', transient: true });
  });

  it('19. multi-sublote: 1º ok + 2º HTTP 400 → éxitos del 1º conservados, sintéticos solo en el 2º', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      call++;
      const body = JSON.parse(init.body);
      if (call === 1) return { ok: true, status: 200, json: async () => ({ data: body.map(() => ({ status: 'ok' })) }) } as any;
      return { ok: false, status: 400, json: async () => ({}) } as any; // 2º sublote rechazado
    });
    const t = new ExpoPushTransport({ fetchImpl });
    const many = Array.from({ length: 150 }, (_, i) => msg(`m${i}`));
    const r = await t.send(many);
    expect(r).toHaveLength(150); // exactamente un resultado por mensaje
    expect(r.slice(0, 100).every((x) => x.ok)).toBe(true); // 1º sublote preservado
    expect(r.slice(100).every((x) => !x.ok && x.providerCode === 'http_400' && x.transient === false)).toBe(true);
    expect(r[149].ref).toBe('m149');
  });

  it('14. access token presente → header Authorization', async () => {
    const calls: any[] = [];
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets, calls), accessToken: 'secret' });
    await t.send([msg('d1')]);
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
  });

  it('15. access token ausente → request válido sin Authorization', async () => {
    const calls: any[] = [];
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets, calls) });
    await t.send([msg('d1')]);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].headers.Accept).toBe('application/json');
  });

  it('16. Host y Accept-Encoding no se fijan manualmente', async () => {
    const calls: any[] = [];
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets, calls) });
    await t.send([msg('d1')]);
    expect(calls[0].headers.Host).toBeUndefined();
    expect(calls[0].headers['Accept-Encoding']).toBeUndefined();
  });

  it('17. payload demasiado grande → permanente sin enviar ese mensaje', async () => {
    const calls: any[] = [];
    const fetchImpl = fetchTickets(okTickets, calls);
    const t = new ExpoPushTransport({ fetchImpl });
    const big = msg('big', tok('big'), { data: { blob: 'x'.repeat(5000) } });
    const r = await t.send([big, msg('ok')]);
    expect(r.find((x) => x.ref === 'big')).toMatchObject({ ok: false, error: 'MessageTooBig', transient: false });
    expect(r.find((x) => x.ref === 'ok')).toMatchObject({ ok: true });
    // el mensaje grande NO se envió: el único fetch llevó solo 'ok'.
    expect(calls).toHaveLength(1);
    expect(calls[0].count).toBe(1);
  });

  it('18. token con formato inválido → permanente sin red', async () => {
    const calls: any[] = [];
    const t = new ExpoPushTransport({ fetchImpl: fetchTickets(okTickets, calls) });
    const r = await t.send([{ ref: 'bad', token: 'not-a-token', title: 't', body: 'b' }]);
    expect(r[0]).toMatchObject({ ref: 'bad', ok: false, error: 'DeviceNotRegistered', providerCode: 'invalid_token_format', transient: false });
    expect(calls).toHaveLength(0); // ningún request real
  });
});
