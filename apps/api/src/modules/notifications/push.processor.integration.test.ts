import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { PushDeliveryClaimRepository } from './push-delivery-claim.repository';
import { DisabledPushTransport } from './disabled-push-transport';
import { FakePushTransport } from './fake-push-transport';
import { PushProcessor } from './push.processor';

/**
 * Integración del PushProcessor (P7-3.b) con FakePushTransport (sin red): éxito→sent,
 * temporal→reprogramado, MAX→failed, DeviceNotRegistered→failed+limpieza condicional del
 * token, token reemplazado→preservado, no doble-claim, send lanza→liberadas, resultado
 * faltante→reintento, resumen sent/failed. Ningún request real a Expo.
 */
describe('PushProcessor · integración', () => {
  let db: DbService;
  let claims: PushDeliveryClaimRepository;
  let fake: FakePushTransport;
  let proc: PushProcessor;
  let tenantId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'push-proc-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    claims = new PushDeliveryClaimRepository(db);
    fake = new FakePushTransport();
    proc = new PushProcessor(db, claims, fake);
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => fake.reset());

  const addDevice = async (token: string | null, user = userId) =>
    (await db.query<{ id: string }>(`INSERT INTO sync_devices (tenant_id, user_id, platform, push_token) VALUES ($1,$2,'android',$3) RETURNING id`, [tenantId, user, token]))[0].id;
  const addPushNotif = async () =>
    (await db.query<{ id: string }>(`INSERT INTO notifications (tenant_id, user_id, channel, title, body, status) VALUES ($1,$2,'push',$3,'b','queued') RETURNING id`, [tenantId, userId, `push-${seq++}`]))[0].id;
  const addDelivery = async (notifId: string, deviceId: string, tokenSnapshot: string, attempt = 0) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO notification_deliveries (tenant_id, notification_id, sync_device_id, token_snapshot, status, attempt_count) VALUES ($1,$2,$3,$4,'queued',$5) RETURNING id`,
        [tenantId, notifId, deviceId, tokenSnapshot, attempt],
      )
    )[0].id;
  const delivery = async (id: string) => (await db.query<any>(`SELECT status, attempt_count, next_attempt_at, processing_at, sent_at, last_error FROM notification_deliveries WHERE id=$1`, [id]))[0];
  const notifStatus = async (id: string) => (await db.query<{ status: string }>(`SELECT status FROM notifications WHERE id=$1`, [id]))[0].status;
  const deviceToken = async (id: string) => (await db.query<{ push_token: string | null }>(`SELECT push_token FROM sync_devices WHERE id=$1`, [id]))[0].push_token;

  it('éxito → sent (sent_at, attempt_count=1, campos limpios) y notificación sent', async () => {
    const dev = await addDevice('tokOK');
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokOK');
    await proc.processTick();
    const r = await delivery(d);
    expect({ status: r.status, attempt: r.attempt_count }).toEqual({ status: 'sent', attempt: 1 });
    expect(r.sent_at).toBeTruthy();
    expect(r.processing_at).toBeNull();
    expect(await notifStatus(n)).toBe('sent');
  });

  it('error temporal → queued reprogramado (attempt+1, next_attempt_at futuro); notificación queued', async () => {
    const dev = await addDevice('tokTMP');
    fake.program('tokTMP', { ok: false, error: 'MessageRateExceeded', transient: true });
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokTMP');
    await proc.processTick();
    const r = await delivery(d);
    expect(r.status).toBe('queued');
    expect(r.attempt_count).toBe(1);
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(r.processing_at).toBeNull();
    expect(await notifStatus(n)).toBe('queued');
  });

  it('MAX_ATTEMPTS alcanzado → failed', async () => {
    const dev = await addDevice('tokMAX');
    fake.program('tokMAX', { ok: false, error: 'MessageRateExceeded', transient: true });
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokMAX', 4); // +1 = 5 = MAX
    await proc.processTick();
    expect((await delivery(d)).status).toBe('failed');
  });

  it('DeviceNotRegistered → failed + limpieza CONDICIONAL del token', async () => {
    const dev = await addDevice('tokDNR');
    fake.program('tokDNR', { ok: false, error: 'DeviceNotRegistered', transient: false });
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokDNR');
    await proc.processTick();
    expect((await delivery(d)).status).toBe('failed');
    expect(await deviceToken(dev)).toBeNull(); // limpiado (coincidía con el snapshot)
  });

  it('token reemplazado antes de procesar → failed(token_replaced), token NUEVO preservado, sin envío', async () => {
    const dev = await addDevice('tokNEW'); // token actual del device
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokOLD'); // snapshot viejo
    await proc.processTick();
    const r = await delivery(d);
    expect({ status: r.status, err: r.last_error }).toEqual({ status: 'failed', err: 'token_replaced' });
    expect(await deviceToken(dev)).toBe('tokNEW'); // NO se borró el token de reemplazo
    expect(fake.sent.find((m) => m.ref === d)).toBeUndefined(); // no se envió
  });

  it('dos claims consecutivos NO reclaman la misma entrega (lease processing_at)', async () => {
    const dev = await addDevice('tokLEASE');
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokLEASE');
    const first = await claims.claimBatch(50);
    const second = await claims.claimBatch(50);
    expect(first.some((c) => c.deliveryId === d)).toBe(true);
    expect(second.some((c) => c.deliveryId === d)).toBe(false); // ya reclamada (processing_at vigente)
  });

  it('send lanza (transporte deshabilitado) → entrega liberada con backoff (no perdida)', async () => {
    const disabledProc = new PushProcessor(db, claims, new DisabledPushTransport());
    const dev = await addDevice('tokTHROW');
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokTHROW');
    await disabledProc.processTick();
    const r = await delivery(d);
    expect(r.status).toBe('queued');
    expect(r.attempt_count).toBe(1);
    expect(r.last_error).toBe('provider_send_exception');
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('resultado faltante (ref sin resultado) → reintento provider_missing_result', async () => {
    const dev = await addDevice('tokOMIT');
    fake.program('tokOMIT', { omit: true });
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokOMIT');
    await proc.processTick();
    const r = await delivery(d);
    expect(r.status).toBe('queued');
    expect(r.last_error).toBe('provider_missing_result');
    expect(r.attempt_count).toBe(1);
  });

  it('mezcla sent + failed en una notificación → resumen sent', async () => {
    const dA = await addDevice('tokMixA');
    const dB = await addDevice('tokMixB');
    fake.program('tokMixB', { ok: false, error: 'DeviceNotRegistered', transient: false });
    const n = await addPushNotif();
    const da = await addDelivery(n, dA, 'tokMixA');
    const dbb = await addDelivery(n, dB, 'tokMixB');
    await proc.processTick();
    expect((await delivery(da)).status).toBe('sent');
    expect((await delivery(dbb)).status).toBe('failed');
    expect(await notifStatus(n)).toBe('sent');
  });

  it('todas failed → resumen failed', async () => {
    const dA = await addDevice('tokAllA');
    const dB = await addDevice('tokAllB');
    fake.program('tokAllA', { ok: false, error: 'DeviceNotRegistered', transient: false });
    fake.program('tokAllB', { ok: false, error: 'DeviceNotRegistered', transient: false });
    const n = await addPushNotif();
    await addDelivery(n, dA, 'tokAllA');
    await addDelivery(n, dB, 'tokAllB');
    await proc.processTick();
    expect(await notifStatus(n)).toBe('failed');
  });

  it('replay de processTick no reenvía entregas terminales', async () => {
    const dev = await addDevice('tokReplay');
    const n = await addPushNotif();
    const d = await addDelivery(n, dev, 'tokReplay');
    await proc.processTick();
    expect((await delivery(d)).status).toBe('sent');
    const sentBefore = fake.sent.filter((m) => m.ref === d).length;
    await proc.processTick(); // no debe re-reclamar ni re-enviar la terminal
    expect(fake.sent.filter((m) => m.ref === d).length).toBe(sentBefore);
  });
});
