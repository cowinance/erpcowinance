import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { BillingService } from './billing.service';

/**
 * Integración del enforcement de límites (B-2): `assertWithinLimit` bloquea (403) al alcanzar el
 * límite del plan y permite por debajo o sin límite. Usa un plan de prueba con límite controlado
 * (los planes reales tienen 500+; el tenant demo trae ~57 animales). `db.tenant` cae al demo.
 */
describe('billing — enforcement de límites', () => {
  let db: DbService;
  let billing: BillingService;
  let t: string;
  let originalCwd: string;
  let tmp: string;

  /** Apunta la suscripción del tenant a un plan de prueba con los límites dados. */
  const setPlan = async (maxAnimals: number | null, maxDevices: number | null) => {
    const code = `test-${randomUUID().slice(0, 8)}`;
    const plan = (
      await db.query<{ id: string }>(
        `INSERT INTO plans (code, name, monthly_price_usd, max_animals, max_devices) VALUES ($1,$1,0,$2,$3) RETURNING id`,
        [code, maxAnimals, maxDevices],
      )
    )[0].id;
    await billing.getSubscription(); // asegura que exista la suscripción (read-through)
    await db.query(`UPDATE subscriptions SET plan_id = $1 WHERE tenant_id = $2 AND deleted_at IS NULL`, [plan, t]);
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'billing-limits-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    billing = new BillingService(db);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('animales: al o por encima del límite → 403; por debajo → ok', async () => {
    await setPlan(1, 100); // demo tiene ~57 activos → 57 >= 1
    await expect(billing.assertWithinLimit('animals')).rejects.toMatchObject({ status: 403 });

    await setPlan(100000, 100);
    await expect(billing.assertWithinLimit('animals')).resolves.toBeUndefined();
  });

  it('dispositivos: límite 0 bloquea; sin límite (null) permite', async () => {
    await setPlan(100000, 0); // 0 dispositivos permitidos → cualquier alta bloqueada
    await expect(billing.assertWithinLimit('devices')).rejects.toMatchObject({ status: 403 });

    await setPlan(null, null); // sin límite → nunca bloquea
    await expect(billing.assertWithinLimit('animals')).resolves.toBeUndefined();
    await expect(billing.assertWithinLimit('devices')).resolves.toBeUndefined();
  });
});
