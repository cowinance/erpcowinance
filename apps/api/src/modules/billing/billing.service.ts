import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';

const TRIAL_DAYS = 30;

/**
 * Facturación SaaS — estado (B-1). SOLO datos/estado: planes, suscripción del tenant, uso vs
 * límites y cambio ADMINISTRATIVO de plan. NO procesa pagos ni credenciales (fuera de alcance;
 * eso es del proveedor). El enforcement de límites es B-2; el cobro real es B-3 (lado proveedor).
 */
@Injectable()
export class BillingService {
  constructor(private readonly db: DbService) {}

  /** Catálogo global de planes activos. */
  async listPlans() {
    return this.db.query(
      `SELECT id, code, name, monthly_price_usd::float AS monthly_price_usd, max_animals, max_users, max_devices, features
       FROM plans WHERE is_active = true AND deleted_at IS NULL ORDER BY monthly_price_usd`,
    );
  }

  /** Garantiza una suscripción para el tenant (read-through): si falta, crea un trial de 30 días. */
  private async ensureSubscription(): Promise<void> {
    const t = this.db.tenant;
    const existing = await this.db.one<{ id: string }>(`SELECT id FROM subscriptions WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`, [t]);
    if (existing) return;
    const trial = await this.db.one<{ id: string }>(`SELECT id FROM plans WHERE code = 'trial' AND is_active = true LIMIT 1`);
    if (!trial) throw new BadRequestException({ code: 'billing.no_trial_plan', title: 'Plan de prueba no configurado' });
    const currency = (await this.db.one<{ c: string }>(`SELECT default_currency AS c FROM organizations WHERE id = $1`, [t]))?.c ?? 'USD';
    await this.db.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, billing_currency, current_period_start, current_period_end, created_by)
       VALUES ($1,$2,'trialing',$3, CURRENT_DATE, CURRENT_DATE + $4::int, $5)`,
      [t, trial.id, currency, TRIAL_DAYS, this.db.user],
    );
  }

  /** Suscripción del tenant + plan + uso vs límites (solo lectura; el enforcement es B-2). */
  async getSubscription() {
    await this.ensureSubscription();
    const t = this.db.tenant;
    const sub = await this.db.one<any>(
      `SELECT s.status, s.billing_currency, s.current_period_start, s.current_period_end, s.canceled_at,
              p.id AS plan_id, p.code AS plan_code, p.name AS plan_name, p.monthly_price_usd::float AS price,
              p.max_animals, p.max_users, p.max_devices
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 1`,
      [t],
    );
    const usage = await this.db.one<any>(
      `SELECT (SELECT count(*)::int FROM animals WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL) AS animals,
              (SELECT count(DISTINCT user_id)::int FROM user_role_assignments WHERE tenant_id=$1) AS users,
              (SELECT count(*)::int FROM sync_devices WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL) AS devices`,
      [t],
    );
    return {
      status: sub.status,
      billing_currency: sub.billing_currency,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      plan: { id: sub.plan_id, code: sub.plan_code, name: sub.plan_name, monthly_price_usd: sub.price },
      limits: { animals: sub.max_animals, users: sub.max_users, devices: sub.max_devices },
      usage,
    };
  }

  /**
   * Enforcement de límites del plan (B-2): lanza 403 `plan.limit_reached` si crear un recurso más
   * superaría el límite del plan. `null` = sin límite. Regla única, invocada por los create-paths
   * (animales, dispositivos). La importación masiva se difiere (flujo propio).
   */
  async assertWithinLimit(resource: 'animals' | 'devices'): Promise<void> {
    await this.ensureSubscription();
    const t = this.db.tenant;
    const plan = await this.db.one<{ max_animals: number | null; max_devices: number | null }>(
      `SELECT p.max_animals, p.max_devices FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 1`,
      [t],
    );
    const limit = resource === 'animals' ? plan?.max_animals : plan?.max_devices;
    if (limit == null) return; // sin límite → no bloquea
    const count =
      resource === 'animals'
        ? (await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animals WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`, [t]))?.n ?? 0
        : (await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM sync_devices WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`, [t]))?.n ?? 0;
    if (count >= limit) {
      const noun = resource === 'animals' ? 'animales' : 'dispositivos';
      throw new ForbiddenException({ code: 'plan.limit_reached', title: `Alcanzaste el límite de ${limit} ${noun} de tu plan. Cambiá de plan para agregar más.` });
    }
  }

  /** Cambio ADMINISTRATIVO de plan (NO cobra). Gated a owner/admin. No altera el estado del cobro. */
  async changePlan(body: any) {
    const role = requestContext.getStore()?.role ?? '';
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException({ code: 'billing.forbidden', title: 'Solo propietario o administrador puede cambiar el plan' });
    }
    const code = String(body?.plan_code ?? '').trim();
    if (!code) throw new BadRequestException({ code: 'billing.missing_plan', title: 'plan_code es obligatorio' });
    const plan = await this.db.one<{ id: string }>(`SELECT id FROM plans WHERE code = $1 AND is_active = true AND deleted_at IS NULL`, [code]);
    if (!plan) throw new NotFoundException({ code: 'billing.plan_not_found', title: `Plan no encontrado: ${code}` });
    await this.ensureSubscription();
    await this.db.query(`UPDATE subscriptions SET plan_id = $1, updated_at = now() WHERE tenant_id = $2 AND deleted_at IS NULL`, [plan.id, this.db.tenant]);
    return this.getSubscription();
  }
}
