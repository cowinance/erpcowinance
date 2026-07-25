import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../weather/weather.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationService } from './notification.service';

/**
 * Integración del motor de notificaciones (P7-1) sobre PGlite aislado (seed demo → hay
 * retiros/vacunas/preñeces → alertas). Verifica: dispatch genera notificaciones in_app
 * `delivered` desde alertas abiertas notificables; DEDUP con dos ejecuciones (índice único);
 * feed determinista; markRead delivered→read (y read→read no-op); unreadCount; y aislamiento
 * por usuario (no marcar/ver la de otro usuario).
 */
describe('NotificationService · integración', () => {
  let db: DbService;
  let notifications: NotificationService;
  let userId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'notif-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    notifications = new NotificationService(db, new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db)));
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const countFor = async (uid: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [uid]))[0].n;

  it('dispatch genera notificaciones in_app delivered desde alertas notificables; excluye sistema', async () => {
    const { inApp } = await notifications.dispatch(userId);
    expect(inApp).toBeGreaterThan(0);

    const rows = await db.query<any>(`SELECT channel, status, sent_at, read_at, alert_id FROM notifications WHERE user_id = $1`, [userId]);
    expect(rows.every((r) => r.channel === 'in_app' && r.status === 'delivered' && r.sent_at === null && r.read_at === null && r.alert_id)).toBe(true);

    // Ninguna notificación proviene de alertas de sistema (categoría 'task': sync stale/conflicts).
    const sysLeak = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications n JOIN alerts a ON a.id = n.alert_id WHERE n.user_id = $1 AND a.category NOT IN ('health','reproduction')`,
      [userId],
    );
    expect(sysLeak[0].n).toBe(0);
  });

  it('dedup: dos ejecuciones consecutivas no duplican (índice único)', async () => {
    const before = await countFor(userId);
    const { inApp } = await notifications.dispatch(userId);
    expect(inApp).toBe(0);
    expect(await countFor(userId)).toBe(before);
  });

  it('feed determinista (orden estable entre llamadas) y solo del usuario', async () => {
    const a = await notifications.feed(userId);
    const b = await notifications.feed(userId);
    expect(a.length).toBeGreaterThan(0);
    // Orden determinista: dos lecturas devuelven exactamente la misma secuencia.
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
    // Monotonía por fecha (desc), tolerante a empates (desempata id desc en SQL).
    for (let i = 1; i < a.length; i++) {
      expect(new Date(a[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(new Date(a[i].created_at).getTime());
    }
    // Otro usuario no ve estas notificaciones.
    expect(await notifications.feed(randomUUID())).toHaveLength(0);
  });

  it('markRead: delivered→read sella read_at; read→read es no-op; unreadCount baja en 1', async () => {
    const before = (await notifications.unreadCount(userId)).count;
    const target = (await notifications.feed(userId)).find((n) => n.status === 'delivered')!;
    const res = await notifications.markRead(target.id, userId);
    expect(res.status).toBe('read');
    const row = (await db.query<any>(`SELECT status, read_at FROM notifications WHERE id = $1`, [target.id]))[0];
    expect(row.status).toBe('read');
    expect(row.read_at).toBeTruthy();
    expect((await notifications.unreadCount(userId)).count).toBe(before - 1);

    // read→read no-op.
    const again = await notifications.markRead(target.id, userId);
    expect(again.status).toBe('read');
  });

  it('refreshUnreadCount: crea el ledger read-through (sin abrir el feed) y es idempotente', async () => {
    // Usuario FRESCO (nunca consultó /notifications): no tiene notificaciones aún.
    const fresh = (
      await db.query<{ id: string }>(`INSERT INTO users (email, full_name) VALUES ($1,'Fresh User') RETURNING id`, [`fresh-${Date.now()}@t.com`])
    )[0].id;
    expect(await countFor(fresh)).toBe(0);

    const r1 = await notifications.refreshUnreadCount(fresh);
    expect(r1.count).toBeGreaterThan(0); // el contador creó las filas in_app desde las alertas abiertas
    const created = await countFor(fresh);
    expect(created).toBe(r1.count);

    const r2 = await notifications.refreshUnreadCount(fresh);
    expect(await countFor(fresh)).toBe(created); // repetir no duplica notificaciones ni deliveries
    expect(r2.count).toBe(r1.count);
  });

  it('aislamiento: marcar la notificación de otro usuario → not_found (no la toca)', async () => {
    const someId = (await notifications.feed(userId))[0].id;
    await expect(notifications.markRead(someId, randomUUID())).rejects.toMatchObject({ response: { code: 'notification.not_found' } });
  });
});
