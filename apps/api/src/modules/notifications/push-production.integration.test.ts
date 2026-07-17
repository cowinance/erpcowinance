import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationService } from './notification.service';

/**
 * Integración de la PRODUCCIÓN del ledger push (P7-3.a): dispatch crea la notificación lógica
 * push y UNA notification_delivery por dispositivo activo con token; sin tokens → solo in_app;
 * idempotente; y sin entrega retroactiva para dispositivos que aparecen después.
 */
describe('NotificationService · producción push (P7-3.a)', () => {
  let db: DbService;
  let notifications: NotificationService;
  let tenantId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'push-prod-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    notifications = new NotificationService(db, new AlertsService(db, { statusAlerts: async () => [] } as any));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const addDevice = async (token: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO sync_devices (tenant_id, user_id, platform, push_token) VALUES ($1,$2,'android',$3) RETURNING id`,
        [tenantId, userId, token],
      )
    )[0].id;
  const pushCount = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND channel='push'`, [userId]))[0].n;
  const deliveryCount = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notification_deliveries WHERE tenant_id=$1`, [tenantId]))[0].n;

  it('sin token: dispatch crea solo in_app (nada de push ni deliveries)', async () => {
    const res = await notifications.dispatch(userId);
    expect(res.inApp).toBeGreaterThan(0);
    expect(res.push).toBe(0);
    expect(res.deliveries).toBe(0);
    expect(await pushCount()).toBe(0);
    expect(await deliveryCount()).toBe(0);
  });

  it('con 2 dispositivos con token: una notificación push por alerta y 2 deliveries cada una', async () => {
    const tokA = `ExponentPushToken[A-${seq++}]`;
    const tokB = `ExponentPushToken[B-${seq++}]`;
    await addDevice(tokA);
    await addDevice(tokB);

    const res = await notifications.dispatch(userId);
    expect(res.push).toBeGreaterThan(0);
    expect(res.deliveries).toBe(res.push * 2);
    expect(await pushCount()).toBe(res.push);

    // Cada notificación push tiene exactamente 2 deliveries queued, con los dos token_snapshot.
    const anyPush = (await db.query<{ id: string; status: string }>(`SELECT id, status FROM notifications WHERE user_id=$1 AND channel='push' LIMIT 1`, [userId]))[0];
    expect(anyPush.status).toBe('queued');
    const dels = await db.query<any>(`SELECT status, token_snapshot, attempt_count FROM notification_deliveries WHERE notification_id=$1 ORDER BY token_snapshot`, [anyPush.id]);
    expect(dels).toHaveLength(2);
    expect(dels.every((d) => d.status === 'queued' && d.attempt_count === 0)).toBe(true);
    expect(dels.map((d) => d.token_snapshot).sort()).toEqual([tokA, tokB].sort());
  });

  it('idempotente: re-dispatch no crea nuevas notificaciones push ni deliveries', async () => {
    const pushBefore = await pushCount();
    const delBefore = await deliveryCount();
    const res = await notifications.dispatch(userId);
    expect(res.push).toBe(0);
    expect(res.deliveries).toBe(0);
    expect(await pushCount()).toBe(pushBefore);
    expect(await deliveryCount()).toBe(delBefore);
  });

  it('sin retroactividad: un dispositivo nuevo NO agrega deliveries a campañas ya despachadas', async () => {
    const delBefore = await deliveryCount();
    await addDevice(`ExponentPushToken[C-${seq++}]`);
    const res = await notifications.dispatch(userId);
    expect(res.deliveries).toBe(0); // las push ya existían → sin entrega retroactiva
    expect(await deliveryCount()).toBe(delBefore);
  });
});
