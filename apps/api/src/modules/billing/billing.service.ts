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
    /**
     * El consumo se cuenta con `contar()`, el MISMO que decide si algo entra o no.
     *
     * Iba en un SELECT aparte y los usuarios se contaban sin filtrar `deleted_at` —a diferencia de
     * animales y dispositivos, ahí nomás en la misma consulta—. No molestaba porque hasta que
     * existieron las invitaciones ninguna asignación se borraba nunca; al revocarle el acceso a
     * alguien, la pantalla seguía contándolo y decía «3 de 5» con un solo usuario adentro.
     *
     * Con una sola definición, lo que se MUESTRA y lo que BLOQUEA no pueden volver a discrepar.
     */
    const [animals, users, devices] = await Promise.all([
      this.contar('animals', t),
      this.contar('users', t),
      this.contar('devices', t),
    ]);
    const usage = { animals, users, devices };
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
   * (animales, dispositivos, usuarios). La importación masiva se difiere (flujo propio).
   *
   * `users` se sumó con las invitaciones: `max_users` existía en `plans` y se contaba como consumo
   * —el panel de plataforma ya marcaba las cuentas pasadas de límite— pero no lo hacía cumplir
   * nadie, porque hasta ahora no había forma de agregar un segundo usuario.
   */
  async assertWithinLimit(resource: 'animals' | 'devices' | 'users'): Promise<void> {
    await this.ensureSubscription();
    const t = this.db.tenant;
    const plan = await this.db.one<{ max_animals: number | null; max_devices: number | null; max_users: number | null }>(
      `SELECT p.max_animals, p.max_devices, p.max_users FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 1`,
      [t],
    );
    const limit = resource === 'animals' ? plan?.max_animals : resource === 'devices' ? plan?.max_devices : plan?.max_users;
    if (limit == null) return; // sin límite → no bloquea
    const count = await this.contar(resource, t);
    if (count >= limit) {
      const noun = resource === 'animals' ? 'animales' : resource === 'devices' ? 'dispositivos' : 'usuarios';
      throw new ForbiddenException({ code: 'plan.limit_reached', title: `Alcanzaste el límite de ${limit} ${noun} de tu plan. Cambiá de plan para agregar más.` });
    }
  }

  /**
   * Consumo actual del recurso.
   *
   * Los usuarios cuentan las asignaciones vigentes MÁS las invitaciones pendientes: una invitación
   * sin aceptar es un lugar ya reservado. Sin eso, mandar seis invitaciones con el plan en cinco
   * pasa el chequeo seis veces —cada una ve cinco usuarios— y el límite se supera igual, solo que
   * el error le aparece al invitado al aceptar, que es a quien menos le sirve.
   */
  private async contar(resource: 'animals' | 'devices' | 'users', t: string): Promise<number> {
    const sql =
      resource === 'animals'
        ? `SELECT count(*)::int AS n FROM animals WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`
        : resource === 'devices'
          ? `SELECT count(*)::int AS n FROM sync_devices WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`
          : `SELECT (SELECT count(DISTINCT user_id) FROM user_role_assignments
                      WHERE tenant_id=$1 AND deleted_at IS NULL
                        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE))
                  + (SELECT count(*) FROM invitations
                      WHERE tenant_id=$1 AND deleted_at IS NULL
                        AND accepted_at IS NULL AND expires_at > now()) AS n`;
    return (await this.db.one<{ n: number }>(sql, [t]))?.n ?? 0;
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
