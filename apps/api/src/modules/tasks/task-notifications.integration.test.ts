import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../alerts/../weather/weather.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationService } from '../notifications/notification.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Tareas E6 — integración con el motor de alertas/notificaciones. Una tarea VENCIDA produce una
 * alerta 'task_overdue' que fluye a una notificación in_app (dedup por alerta, reusa el pipeline
 * P7). Las reglas de sistema (sync_*) NO notifican aunque sean categoría 'task'.
 */
describe('Tareas · notificaciones (E6)', () => {
  let db: DbService;
  let alerts: AlertsService;
  let notifications: NotificationService;
  let userId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'tasknotif-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    alerts = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    notifications = new NotificationService(db, alerts);
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('tarea vencida → alerta task_overdue → notificación in_app; dedup al re-despachar', async () => {
    // Tarea vencida (due ayer, pendiente).
    await db.query(
      `INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, priority, status, created_by)
       VALUES ($1,$2,'Reparar boyero perimetral','maintenance', CURRENT_DATE - 2, 'high','pending',$3)`,
      [db.tenant, farmId, userId],
    );

    await alerts.evaluate();
    const alertRow = await db.query<any>(
      `SELECT id, title, category FROM alerts WHERE tenant_id=$1 AND title LIKE 'Tarea vencida:%' AND status='open'`,
      [db.tenant],
    );
    expect(alertRow.length).toBeGreaterThanOrEqual(1);
    expect(alertRow[0].category).toBe('task');

    const first = await notifications.dispatch(userId);
    expect(first.inApp).toBeGreaterThan(0);
    const feed = await notifications.feed(userId);
    expect(feed.some((n: any) => n.title?.includes('Reparar boyero perimetral'))).toBe(true);

    // Dedup: re-despachar no crea la misma notificación otra vez.
    const before = feed.length;
    await notifications.dispatch(userId);
    const after = await notifications.feed(userId);
    expect(after.length).toBe(before);
  });

  it('las reglas de sistema (sync_*) NO generan notificación aunque sean categoría task', async () => {
    const feed = await notifications.feed(userId);
    expect(feed.some((n: any) => /sincroniz/i.test(n.title ?? ''))).toBe(false);
  });
});
