import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { PushDeliveryClaimRepository } from './push-delivery-claim.repository';
import { ExpoPushTransport } from './expo-push-transport';
import { PushProcessor } from './push.processor';
import { PushTransportRequestError, type PushMessage, type PushSendResult, type PushTransport } from './push-transport.port';

/**
 * Integración processor ↔ adapter REAL (P7-3.c.2): PushProcessor → ExpoPushTransport → fetch
 * MOCKEADO → PushSendResult/PushTransportRequestError → persistencia de delivery. La
 * clasificación atraviesa el puerto real (no se reproduce en el test). Cero red real.
 */
describe('PushProcessor ↔ ExpoPushTransport · integración', () => {
  let db: DbService;
  let claims: PushDeliveryClaimRepository;
  let tenantId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  let fetchMock: (url: string, init: any) => Promise<any>;
  let fetchCalls = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'push-expo-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    claims = new PushDeliveryClaimRepository(db);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const procWithExpo = () =>
    new PushProcessor(
      db,
      claims,
      new ExpoPushTransport({
        fetchImpl: (u: any, i: any) => {
          fetchCalls++;
          return fetchMock(u, i);
        },
      }) as any,
      { enabled: true },
    );

  // Mock que devuelve un ticket por mensaje según su token (preserva orden interno del adapter).
  const ticketsBy = (fn: (token: string) => any) => async (_u: string, i: any) => {
    const body = JSON.parse(i.body) as Array<{ to: string }>;
    return { ok: true, status: 200, json: async () => ({ data: body.map((m) => fn(m.to)) }) };
  };
  const http = (status: number) => async () => ({ ok: false, status, json: async () => ({}) });

  const tok = (n: string) => `ExponentPushToken[${n}-${seq++}]`;
  const addDevice = async (token: string) => (await db.query<{ id: string }>(`INSERT INTO sync_devices (tenant_id, user_id, platform, push_token) VALUES ($1,$2,'android',$3) RETURNING id`, [tenantId, userId, token]))[0].id;
  const addPushNotif = async () => (await db.query<{ id: string }>(`INSERT INTO notifications (tenant_id, user_id, channel, title, body, status) VALUES ($1,$2,'push',$3,'b','queued') RETURNING id`, [tenantId, userId, `p-${seq++}`]))[0].id;
  const addDelivery = async (n: string, dev: string, token: string) => (await db.query<{ id: string }>(`INSERT INTO notification_deliveries (tenant_id, notification_id, sync_device_id, token_snapshot, status) VALUES ($1,$2,$3,$4,'queued') RETURNING id`, [tenantId, n, dev, token]))[0].id;
  const del = async (id: string) => (await db.query<any>(`SELECT status, attempt_count, last_error FROM notification_deliveries WHERE id=$1`, [id]))[0];
  const notifStatus = async (id: string) => (await db.query<{ status: string }>(`SELECT status FROM notifications WHERE id=$1`, [id]))[0].status;
  const devTok = async (id: string) => (await db.query<{ push_token: string | null }>(`SELECT push_token FROM sync_devices WHERE id=$1`, [id]))[0].push_token;
  const one = async (token: string) => { const dev = await addDevice(token); const n = await addPushNotif(); const d = await addDelivery(n, dev, token); return { dev, n, d }; };

  it('1. ticket ok → sent', async () => {
    fetchMock = ticketsBy(() => ({ status: 'ok' }));
    const { d, n } = await one(tok('ok'));
    await procWithExpo().processTick();
    expect((await del(d)).status).toBe('sent');
    expect(await notifStatus(n)).toBe('sent');
  });

  it('2. DeviceNotRegistered → failed + limpieza condicional del token', async () => {
    fetchMock = ticketsBy(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } }));
    const t = tok('dnr');
    const { d, dev } = await one(t);
    await procWithExpo().processTick();
    expect((await del(d)).status).toBe('failed');
    expect(await devTok(dev)).toBeNull();
  });

  it('3. MessageRateExceeded → backoff', async () => {
    fetchMock = ticketsBy(() => ({ status: 'error', details: { error: 'MessageRateExceeded' } }));
    const { d } = await one(tok('rate'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', attempt_count: 1, last_error: 'MessageRateExceeded' });
  });

  it('4. código individual desconocido → backoff con providerCode preservado', async () => {
    fetchMock = ticketsBy(() => ({ status: 'error', details: { error: 'WeirdError' } }));
    const { d } = await one(tok('unk'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', last_error: 'WeirdError' });
  });

  it('5. HTTP 429 → backoff', async () => {
    fetchMock = http(429);
    const { d } = await one(tok('h429'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', last_error: 'http_429' });
  });

  it('6. HTTP 500 → backoff', async () => {
    fetchMock = http(500);
    const { d } = await one(tok('h500'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', last_error: 'http_500' });
  });

  it('7. HTTP 400 → failed, sin reintento', async () => {
    fetchMock = http(400);
    const { d } = await one(tok('h400'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'failed', last_error: 'http_400' });
  });

  it('8. ticket faltante → backoff', async () => {
    fetchMock = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }); // 0 tickets
    const { d } = await one(tok('miss'));
    await procWithExpo().processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', last_error: 'provider_missing_result' });
  });

  it('9. mezcla éxito + permanente → resumen lógico sent', async () => {
    const good = tok('mixOK');
    const bad = tok('mixDNR');
    fetchMock = ticketsBy((t) => (t === bad ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
    const devA = await addDevice(good);
    const devB = await addDevice(bad);
    const n = await addPushNotif();
    const da = await addDelivery(n, devA, good);
    const dbb = await addDelivery(n, devB, bad);
    await procWithExpo().processTick();
    expect((await del(da)).status).toBe('sent');
    expect((await del(dbb)).status).toBe('failed');
    expect(await notifStatus(n)).toBe('sent');
  });

  it('10. ningún request real: todo pasa por el fetch mockeado', async () => {
    fetchMock = ticketsBy(() => ({ status: 'ok' }));
    const before = fetchCalls;
    await one(tok('count'));
    await procWithExpo().processTick();
    expect(fetchCalls).toBeGreaterThan(before);
  });

  it('11. transporte que LANZA PushTransportRequestError permanente → failed (defensivo)', async () => {
    const throwing: PushTransport = { send: async (_m: PushMessage[]): Promise<PushSendResult[]> => { throw new PushTransportRequestError('http_400', false); } };
    const { d } = await one(tok('throwPerm'));
    await new PushProcessor(db, claims, throwing, { enabled: true }).processTick();
    expect((await del(d))).toMatchObject({ status: 'failed', last_error: 'http_400' });
  });

  it('12. transporte que LANZA PushTransportRequestError temporal → backoff (defensivo)', async () => {
    const throwing: PushTransport = { send: async (): Promise<PushSendResult[]> => { throw new PushTransportRequestError('http_503', true); } };
    const { d } = await one(tok('throwTmp'));
    await new PushProcessor(db, claims, throwing, { enabled: true }).processTick();
    expect((await del(d))).toMatchObject({ status: 'queued', last_error: 'http_503' });
  });
});
