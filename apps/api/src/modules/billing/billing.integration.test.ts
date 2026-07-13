import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from './billing.service';
import { requestContext } from '../../common/request-context';

/**
 * Integración de Facturación SaaS B-1: read-through de trial, uso vs límites, cambio de plan
 * (gated a owner/admin) y errores. Sin flujos de pago. `db.tenant`/`db.user` caen al tenant demo.
 */
describe('billing — estado de suscripción', () => {
  let db: DbService;
  let billing: BillingService;
  let t: string;
  let u: string;
  let originalCwd: string;
  let tmp: string;

  const asRole = <T>(role: string, fn: () => Promise<T>) => requestContext.run({ userId: u, tenantId: t, role }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'billing-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    billing = new BillingService(db);
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    u = (await db.query<{ user_id: string }>(`SELECT user_id FROM user_role_assignments WHERE tenant_id = $1 LIMIT 1`, [t]))[0]?.user_id ?? t;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('read-through: crea un trial si falta; devuelve plan, límites y uso', async () => {
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [t]);
    expect(before[0].n).toBe(0);

    const sub = await billing.getSubscription();
    expect(sub.status).toBe('trialing');
    expect(sub.plan.code).toBe('trial');
    expect(sub.limits).toEqual({ animals: 1000, users: 5, devices: 5 });
    expect(typeof sub.usage.animals).toBe('number');
    expect(sub.usage.users).toBeGreaterThanOrEqual(1);

    // Idempotente: no crea una segunda.
    await billing.getSubscription();
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1 AND deleted_at IS NULL`, [t]);
    expect(after[0].n).toBe(1);
  });

  it('listPlans devuelve el catálogo sembrado', async () => {
    const plans = await billing.listPlans();
    expect(plans.map((p: any) => p.code).sort()).toEqual(['basico', 'pro', 'trial']);
  });

  it('cambiar de plan: owner OK; worker prohibido; plan inexistente 404; sin plan_code 400', async () => {
    const changed = await asRole('owner', () => billing.changePlan({ plan_code: 'pro' }));
    expect(changed.plan.code).toBe('pro');
    expect(changed.limits.animals).toBe(5000);

    await expect(asRole('worker', () => billing.changePlan({ plan_code: 'basico' }))).rejects.toMatchObject({ status: 403 });
    await expect(asRole('owner', () => billing.changePlan({ plan_code: 'inexistente' }))).rejects.toMatchObject({ status: 404 });
    await expect(asRole('owner', () => billing.changePlan({}))).rejects.toMatchObject({ status: 400 });
  });
});
