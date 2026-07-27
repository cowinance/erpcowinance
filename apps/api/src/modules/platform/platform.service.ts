import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from './platform.db';
import type { Q } from '../../db/db.service';

/**
 * Lecturas globales del panel de plataforma (fase 1: SOLO lectura).
 *
 * ## Qué se expone y qué no
 *
 * Las consultas son de ADMINISTRACIÓN DE CUENTAS, no de negocio ajeno: cuántas fincas hay, en qué
 * estado, cuánta gente y cuántos animales tiene cada una (que es lo que se factura), qué plan,
 * cuánto almacenamiento. Los CONTENIDOS de la finca —sanidad, ventas, sueldos, pesadas— quedan
 * afuera, y no por convención sino porque esas tablas no están en `PLATFORM_READ_TABLES` y la RLS
 * las deniega (ver `db/rls.ts`).
 *
 * De ahí sale la forma de la «actividad reciente» del detalle de organización: se deriva de altas
 * de animales, subidas de archivos, sincronizaciones y logins. Dice si la cuenta está VIVA, que es
 * lo que necesita saber quien la administra, sin ser un espejo de la finca.
 *
 * ## Higiene de campos sensibles
 *
 * Ningún `SELECT *` sobre `users`, en ninguna consulta de este archivo. Las columnas van
 * enumeradas a mano justamente para que `password_hash` no pueda entrar por descuido cuando
 * alguien agregue un campo al listado. Lo verifica un test que revisa la respuesta serializada.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly pdb: PlatformDb) {}

  // ── Dashboard global ─────────────────────────────────────────────────────────────────────────

  async dashboard() {
    return this.pdb.read(async (q) => {
      const organizations = await q.one<Record<string, number>>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'active')::int    AS active,
                count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE status = 'churned')::int   AS churned,
                count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS created_30d,
                count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int  AS created_7d
           FROM organizations WHERE deleted_at IS NULL`,
      );

      // `status='deleted'` y `deleted_at` son dos formas de lo mismo en este esquema (la primera es
      // del CHECK de la columna, la segunda del borrado lógico general). Contarlas por separado
      // daría dos números que no cierran; se unifican acá.
      const users = await q.one<Record<string, number>>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL)::int  AS active,
                count(*) FILTER (WHERE status = 'blocked')::int                        AS blocked,
                count(*) FILTER (WHERE status = 'deleted' OR deleted_at IS NOT NULL)::int AS deleted,
                count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int             AS email_verified,
                count(*) FILTER (WHERE email_verified_at IS NULL)::int                 AS email_unverified,
                count(*) FILTER (WHERE created_at  >= now() - interval '30 days')::int AS created_30d,
                count(*) FILTER (WHERE last_login_at >= now() - interval '7 days')::int  AS logged_in_7d,
                count(*) FILTER (WHERE last_login_at >= now() - interval '30 days')::int AS logged_in_30d
           FROM users`,
      );

      const storage = await q.one<{ files: number; bytes: string }>(
        `SELECT count(*)::int AS files, COALESCE(sum(size_bytes), 0)::text AS bytes
           FROM files WHERE deleted_at IS NULL`,
      );

      const herd = await q.one<{ active_animals: number }>(
        `SELECT count(*)::int AS active_animals
           FROM animals WHERE status = 'active' AND deleted_at IS NULL`,
      );

      const devices = await q.one<{ active: number; total: number }>(
        `SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total
           FROM sync_devices WHERE deleted_at IS NULL`,
      );

      const plans = await q.query<{ code: string; name: string; status: string; n: number }>(
        `SELECT p.code, p.name, s.status, count(*)::int AS n
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.deleted_at IS NULL
          GROUP BY p.code, p.name, s.status
          ORDER BY p.code`,
      );

      const recentOrganizations = await q.query(
        `SELECT id, name, country_code, status, created_at
           FROM organizations WHERE deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 5`,
      );

      const recentLogins = await q.query(
        `SELECT id, full_name AS name, email, last_login_at
           FROM users WHERE last_login_at IS NOT NULL AND deleted_at IS NULL
          ORDER BY last_login_at DESC LIMIT 5`,
      );

      // `q.one` devuelve `T | undefined`, y una agregación sin GROUP BY siempre trae una fila —
      // pero el tipo no lo sabe y el panel se caería con `undefined.total`. El `?? {}` deja el
      // contrato del endpoint sin opcionales: la UI recibe siempre la forma completa.
      /**
       * ATENCIÓN — a quién llamar hoy.
       *
       * El resumen eran ocho contadores correctos y ninguno accionable: decían cuántas cuentas hay,
       * no cuál necesita algo. Un dueño de plataforma abre esto para decidir a quién escribirle.
       *
       * Los tres grupos son las tres formas de perder plata que este panel puede ver:
       *  · el período que vence (una prueba que nadie convierte se pierde sola),
       *  · la cuenta que dejó de entrar (baja silenciosa, se detecta antes de que pida el reembolso),
       *  · la que ya no entra en su plan (upgrade que nadie ofreció).
       *
       * Se devuelven las 5 primeras de cada uno más el total: la tarjeta es para empezar a trabajar,
       * y el listado completo está a un clic con el mismo filtro aplicado.
       */
      const atencion = await q.one<Record<string, unknown>>(
        `WITH cuentas AS (${ORGANIZATION_SELECT} WHERE o.deleted_at IS NULL AND o.status = 'active')
         SELECT
           (SELECT count(*)::int FROM cuentas WHERE dias_para_vencer IS NOT NULL AND dias_para_vencer <= 7) AS expiring_total,
           (SELECT COALESCE(json_agg(x), '[]') FROM (
              SELECT id, name, plan_code, dias_para_vencer, current_period_end FROM cuentas
               WHERE dias_para_vencer IS NOT NULL AND dias_para_vencer <= 7
               ORDER BY dias_para_vencer LIMIT 5) x) AS expiring,
           (SELECT count(*)::int FROM cuentas
             WHERE last_login_at IS NULL OR last_login_at < now() - interval '30 days') AS idle_total,
           (SELECT COALESCE(json_agg(x), '[]') FROM (
              SELECT id, name, last_login_at, animals FROM cuentas
               WHERE last_login_at IS NULL OR last_login_at < now() - interval '30 days'
               ORDER BY last_login_at NULLS FIRST LIMIT 5) x) AS idle,
           (SELECT count(*)::int FROM cuentas
             WHERE (max_animals IS NOT NULL AND animals >= max_animals)
                OR (max_users IS NOT NULL AND users >= max_users)) AS over_limit_total,
           (SELECT COALESCE(json_agg(x), '[]') FROM (
              SELECT id, name, plan_code, animals, max_animals, users, max_users FROM cuentas
               WHERE (max_animals IS NOT NULL AND animals >= max_animals)
                  OR (max_users IS NOT NULL AND users >= max_users)
               ORDER BY animals DESC LIMIT 5) x) AS over_limit`,
      );

      return {
        organizations: organizations ?? {},
        users: users ?? {},
        attention: atencion ?? {},
        herd: { active_animals: herd?.active_animals ?? 0 },
        devices: devices ?? { active: 0, total: 0 },
        // `bytes` viaja como TEXTO: `sum(bigint)` es numeric y con varios terabytes se pasa del
        // entero seguro de JavaScript. Los MB/GB se calculan en la UI a partir de este valor.
        storage: { files: storage?.files ?? 0, bytes: storage?.bytes ?? '0' },
        plans: groupPlans(plans),
        recent: { organizations: recentOrganizations, logins: recentLogins },
      };
    });
  }

  // ── Organizaciones ───────────────────────────────────────────────────────────────────────────

  async organizations(filters: OrganizationFilters) {
    const { limit, offset } = paginate(filters);
    const where: string[] = ['o.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.q?.trim()) {
      params.push(`%${filters.q.trim()}%`);
      where.push(`(o.name ILIKE $${params.length} OR o.legal_name ILIKE $${params.length})`);
    }
    if (filters.status?.trim()) {
      params.push(filters.status.trim());
      where.push(`o.status = $${params.length}`);
    }
    if (filters.country?.trim()) {
      params.push(filters.country.trim().toUpperCase());
      where.push(`o.country_code = $${params.length}`);
    }
    if (filters.plan?.trim()) {
      params.push(filters.plan.trim());
      where.push(`p.code = $${params.length}`);
    }
    const clause = where.join(' AND ');

    /**
     * Los filtros de ATENCIÓN se aplican AFUERA, sobre el resultado ya calculado.
     *
     * `animales`, `usuarios` y `dias_para_vencer` son subconsultas escalares del propio SELECT: no
     * existen todavía cuando corre el `WHERE` de adentro. Repetirlas en el `WHERE` funcionaría, pero
     * dejaría la misma regla escrita dos veces y con dos oportunidades de divergir. Envolviendo, la
     * definición de «vencido» o «sobre el límite» vive en un solo lugar.
     */
    const atencion: string[] = [];
    if (filters.expiring?.trim()) {
      params.push(Number(filters.expiring) || 7);
      atencion.push(`dias_para_vencer IS NOT NULL AND dias_para_vencer <= $${params.length}`);
    }
    if (filters.idle?.trim()) {
      params.push(Number(filters.idle) || 30);
      // «Nunca entró» cuenta como inactiva: es el caso de la cuenta que se registró y no volvió,
      // que es justamente a quien más conviene llamar.
      atencion.push(`(last_login_at IS NULL OR last_login_at < now() - ($${params.length} || ' days')::interval)`);
    }
    if (filters.over_limit?.trim())
      atencion.push(
        `((max_animals IS NOT NULL AND animals >= max_animals) OR (max_users IS NOT NULL AND users >= max_users))`,
      );
    const externa = atencion.length ? `WHERE ${atencion.join(' AND ')}` : '';

    return this.pdb.read(async (q) => {
      const rows = await q.query(
        `SELECT * FROM (${ORGANIZATION_SELECT} WHERE ${clause}) t
          ${externa}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const total = await q.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM (${ORGANIZATION_SELECT} WHERE ${clause}) t ${externa}`,
        params,
      );
      // Facetas: los valores POSIBLES del filtro, sobre el conjunto SIN filtrar.
      //
      // La web las derivaba de la página que estaba mostrando, y eso se rompe solo: al filtrar por
      // «VE» el selector se quedaba con «VE» como única opción y ya no había forma de volver a
      // «AR» sin editar la URL a mano. Un filtro que se cierra sobre sí mismo es peor que no tener
      // filtro.
      const countries = await q.query<{ code: string }>(
        `SELECT DISTINCT country_code AS code FROM organizations WHERE deleted_at IS NULL ORDER BY 1`,
      );
      return {
        data: rows,
        total: total?.n ?? 0,
        limit,
        offset,
        facets: { countries: countries.map((c) => c.code) },
      };
    });
  }

  async organization(id: string) {
    return this.pdb.read(async (q) => {
      const org = await q.one<Record<string, unknown>>(`${ORGANIZATION_SELECT} WHERE o.id = $1`, [id]);
      if (!org)
        throw new NotFoundException({ code: 'platform.org_not_found', title: 'Organización no encontrada' });

      const users = await q.query(
        `SELECT u.id, u.full_name AS name, u.email, u.email_verified_at IS NOT NULL AS email_verified,
                u.status, u.last_login_at, u.created_at, r.code AS role
           FROM user_role_assignments ura
           JOIN users u ON u.id = ura.user_id
           LEFT JOIN roles r ON r.id = ura.role_id
          WHERE ura.tenant_id = $1 AND ura.deleted_at IS NULL
          ORDER BY u.created_at`,
        [id],
      );

      const farms = await q.query(
        `SELECT f.id, f.name, f.official_code, f.total_area_ha::float AS total_area_ha, f.is_active,
                f.timezone, f.created_at, c.name AS company_name
           FROM farms f LEFT JOIN companies c ON c.id = f.company_id
          WHERE f.tenant_id = $1 AND f.deleted_at IS NULL
          ORDER BY f.created_at`,
        [id],
      );

      const subscription = await q.one(
        `SELECT s.status, s.billing_currency, s.current_period_start, s.current_period_end,
                s.canceled_at, s.created_at,
                p.code AS plan_code, p.name AS plan_name, p.monthly_price_usd::float AS monthly_price_usd,
                p.max_animals, p.max_users, p.max_devices
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT 1`,
        [id],
      );

      const payments = await q.query(
        `SELECT id, amount::float AS amount, currency, status, gateway, paid_at, created_at
           FROM billing_payments WHERE tenant_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 10`,
        [id],
      );

      const usage = await q.one<Record<string, unknown>>(
        `SELECT (SELECT count(*)::int FROM animals WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL) AS active_animals,
                (SELECT count(*)::int FROM animals WHERE tenant_id = $1 AND deleted_at IS NULL) AS total_animals,
                (SELECT count(DISTINCT user_id)::int FROM user_role_assignments WHERE tenant_id = $1 AND deleted_at IS NULL) AS users,
                (SELECT count(*)::int FROM sync_devices WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL) AS active_devices,
                (SELECT count(*)::int FROM files WHERE tenant_id = $1 AND deleted_at IS NULL) AS files,
                (SELECT COALESCE(sum(size_bytes), 0)::text FROM files WHERE tenant_id = $1 AND deleted_at IS NULL) AS storage_bytes,
                (SELECT count(*)::int FROM farms WHERE tenant_id = $1 AND deleted_at IS NULL) AS farms`,
        [id],
      );

      // Actividad: SEÑALES de que la cuenta se usa, no contenido de la finca (ver el comentario de
      // la clase). Todo sale de las tablas del allowlist más `users`.
      const activity = await q.one<Record<string, unknown>>(
        `SELECT (SELECT max(created_at) FROM animals WHERE tenant_id = $1) AS last_animal_at,
                (SELECT count(*)::int FROM animals WHERE tenant_id = $1 AND created_at >= now() - interval '30 days') AS animals_30d,
                (SELECT max(created_at) FROM files WHERE tenant_id = $1) AS last_file_at,
                (SELECT count(*)::int FROM files WHERE tenant_id = $1 AND created_at >= now() - interval '30 days') AS files_30d,
                (SELECT max(last_sync_at) FROM sync_devices WHERE tenant_id = $1) AS last_sync_at,
                (SELECT max(u.last_login_at) FROM users u
                   JOIN user_role_assignments ura ON ura.user_id = u.id AND ura.tenant_id = $1) AS last_login_at`,
        [id],
      );

      return { organization: org, users, farms, subscription, payments, usage, activity };
    });
  }

  // ── Usuarios ─────────────────────────────────────────────────────────────────────────────────

  async users(filters: UserFilters) {
    const { limit, offset } = paginate(filters);
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (filters.q?.trim()) {
      params.push(`%${filters.q.trim()}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    if (filters.status?.trim()) {
      params.push(filters.status.trim());
      where.push(`u.status = $${params.length}`);
    }
    if (filters.email_verified === 'true') where.push('u.email_verified_at IS NOT NULL');
    if (filters.email_verified === 'false') where.push('u.email_verified_at IS NULL');
    const clause = where.join(' AND ');

    return this.pdb.read(async (q) => {
      // `json_agg … FILTER (WHERE o.id IS NOT NULL)` y no un `json_agg` pelado: con el LEFT JOIN,
      // un usuario sin organización produciría `[{tenant_id:null,…}]` en vez de `[]`, y la UI
      // dibujaría una organización fantasma.
      const data = await q.query(
        `SELECT u.id, u.full_name AS name, u.email,
                u.email_verified_at IS NOT NULL AS email_verified,
                u.status, u.last_login_at, u.created_at,
                pa.role AS platform_role,
                COALESCE(
                  json_agg(
                    json_build_object('tenant_id', o.id, 'name', o.name, 'role', r.code)
                    ORDER BY o.name
                  ) FILTER (WHERE o.id IS NOT NULL), '[]'
                ) AS organizations
           FROM users u
           LEFT JOIN user_role_assignments ura ON ura.user_id = u.id AND ura.deleted_at IS NULL
           LEFT JOIN organizations o ON o.id = ura.tenant_id AND o.deleted_at IS NULL
           LEFT JOIN roles r ON r.id = ura.role_id
           LEFT JOIN platform_admins pa ON pa.user_id = u.id AND pa.disabled_at IS NULL
          WHERE ${clause}
          GROUP BY u.id, pa.role
          ORDER BY u.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const total = await q.one<{ n: number }>(`SELECT count(*)::int AS n FROM users u WHERE ${clause}`, params);
      return { data, total: total?.n ?? 0, limit, offset };
    });
  }

  /**
   * Catálogo de planes activos. Lo necesita el selector de «cambiar plan» del panel.
   *
   * `plans` es un catálogo GLOBAL (sin `tenant_id`, sin RLS), así que no hace falta que esté en
   * ninguna lista de la policy: se lee igual.
   */
  async plans() {
    return this.pdb.read((q) =>
      q.query(
        `SELECT code, name, monthly_price_usd::float AS monthly_price_usd, max_animals, max_users, max_devices
           FROM plans WHERE is_active = true AND deleted_at IS NULL ORDER BY monthly_price_usd`,
      ),
    );
  }

  /**
   * Bitácora global, filtrable.
   *
   * ## Por qué hay dos CLASES de entrada y no una sola lista
   *
   * Medido sobre la bitácora real: de 99 entradas, 75 eran navegación del panel. Las que justifican
   * que este módulo exista —una suspensión, un modo espejo— quedaban sepultadas, y con un tope de
   * filas se van de la ventana en un rato de uso. Una auditoría que empeora cuanto más se usa el
   * sistema no sirve para auditar.
   *
   * La separación es por lo que la entrada SIGNIFICA:
   *
   *  · `accion` — cambió algo o entró a la finca de un cliente. Llevan nombre de dominio
   *    (`organization.suspend`, `user.impersonate`, `platform.login`) y motivo obligatorio.
   *  · `acceso` — alguien MIRÓ. Conservan la forma `MÉTODO /ruta` porque salen del interceptor.
   *
   * No se descarta ninguna: el panel muestra acciones por defecto y los accesos a un clic. «Quién
   * miró esta finca» sigue siendo respondible, que era el punto de registrarlos.
   *
   * La clase se DERIVA del nombre en vez de guardarse en una columna. Es una migración menos, y la
   * invariante que la sostiene es simple y ya se cumple: los eventos de dominio llevan punto, los
   * de navegación empiezan con el verbo HTTP.
   */
  async auditLog(filters: AuditFilters = {}) {
    const { limit, offset } = paginate({ ...filters, limit: filters.limit ?? 100 });
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (filters.kind === 'accion') where.push(`action NOT LIKE 'GET %'`);
    if (filters.kind === 'acceso') where.push(`action LIKE 'GET %'`);

    if (filters.actor?.trim()) {
      params.push(`%${filters.actor.trim()}%`);
      where.push(`actor_email ILIKE $${params.length}`);
    }
    if (filters.tenant?.trim()) {
      params.push(filters.tenant.trim());
      where.push(`target_tenant_id = $${params.length}`);
    }
    if (filters.action?.trim()) {
      params.push(filters.action.trim());
      where.push(`action = $${params.length}`);
    }
    if (filters.outcome?.trim()) {
      params.push(filters.outcome.trim());
      where.push(`outcome = $${params.length}`);
    }
    // Fechas como día suelto (`2026-07-26`): `to` va con `< dia+1` y no con `<=`, porque `<=` sobre
    // un timestamp deja afuera todo lo que pasó DESPUÉS de la medianoche de ese día — o sea, el día
    // entero salvo el primer instante. Es el error clásico de los filtros «hasta».
    if (filters.from?.trim()) {
      params.push(filters.from.trim());
      where.push(`occurred_at >= $${params.length}::date`);
    }
    if (filters.to?.trim()) {
      params.push(filters.to.trim());
      where.push(`occurred_at < ($${params.length}::date + 1)`);
    }
    const clause = where.join(' AND ');

    return this.pdb.read(async (q: Q) => {
      const data = await q.query(
        `SELECT id, actor_email, actor_role, action, outcome, target_type, target_id,
                target_tenant_id, detail, ip_address, occurred_at,
                (action NOT LIKE 'GET %') AS es_accion
           FROM platform_audit_logs
          WHERE ${clause}
          ORDER BY occurred_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const total = await q.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_audit_logs WHERE ${clause}`,
        params,
      );
      // Facetas sobre el conjunto SIN filtrar, por lo mismo que en organizaciones: un selector que
      // se queda solo con el valor ya elegido no deja volver atrás sin editar la URL.
      const actores = await q.query<{ actor_email: string }>(
        `SELECT DISTINCT actor_email FROM platform_audit_logs WHERE actor_email IS NOT NULL ORDER BY actor_email`,
      );
      const acciones = await q.query<{ action: string }>(
        `SELECT DISTINCT action FROM platform_audit_logs WHERE action NOT LIKE 'GET %' ORDER BY action`,
      );
      return {
        data,
        total: total?.n ?? 0,
        limit,
        offset,
        facets: { actors: actores.map((a) => a.actor_email), actions: acciones.map((a) => a.action) },
      };
    });
  }
}

/**
 * Fila de organización enriquecida. Vive como constante porque el listado y el detalle tienen que
 * devolver EXACTAMENTE la misma forma: si divergen, la tabla y la ficha muestran números distintos
 * para la misma finca y no hay forma de saber cuál miente.
 */
const ORGANIZATION_SELECT = `
  SELECT o.id, o.name, o.legal_name, o.country_code, o.default_currency, o.timezone,
         o.status, o.created_at,
         (SELECT count(DISTINCT ura.user_id)::int FROM user_role_assignments ura
           WHERE ura.tenant_id = o.id AND ura.deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM animals a
           WHERE a.tenant_id = o.id AND a.status = 'active' AND a.deleted_at IS NULL) AS animals,
         p.code AS plan_code, p.name AS plan_name,
         p.max_animals, p.max_users, p.max_devices,
         s.status AS subscription_status, s.current_period_end,
         -- Días hasta el fin del período. Negativo = ya venció. Se calcula acá y no en la UI
         -- porque de esto dependen un filtro y una tarjeta del resumen: si cada consumidor lo
         -- derivara por su cuenta, tarde o temprano dirían cosas distintas sobre la misma cuenta.
         (s.current_period_end - CURRENT_DATE) AS dias_para_vencer,
         (SELECT max(u.last_login_at) FROM users u
            JOIN user_role_assignments ura2 ON ura2.user_id = u.id AND ura2.tenant_id = o.id) AS last_login_at
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT s.plan_id, s.status, s.current_period_end FROM subscriptions s
       WHERE s.tenant_id = o.id AND s.deleted_at IS NULL
       ORDER BY s.created_at DESC LIMIT 1
    ) s ON true
    LEFT JOIN plans p ON p.id = s.plan_id`;

export interface OrganizationFilters {
  q?: string;
  status?: string;
  country?: string;
  plan?: string;
  /** Días: período que vence dentro de N (o ya vencido). */
  expiring?: string;
  /** Días: sin que ningún usuario ingrese hace N — o que nunca ingresó. */
  idle?: string;
  /** Cualquier valor: cuentas que alcanzaron o pasaron el límite de animales o usuarios del plan. */
  over_limit?: string;
  limit?: string | number;
  offset?: string | number;
}

export interface AuditFilters {
  /** `accion` = cambió algo o entró a una finca · `acceso` = alguien miró. Vacío = todo. */
  kind?: 'accion' | 'acceso' | '';
  actor?: string;
  tenant?: string;
  action?: string;
  outcome?: string;
  /** Día suelto `YYYY-MM-DD`, inclusive en los dos extremos. */
  from?: string;
  to?: string;
  limit?: string | number;
  offset?: string | number;
}

export interface UserFilters {
  q?: string;
  status?: string;
  email_verified?: string;
  limit?: string | number;
  offset?: string | number;
}

/**
 * Paginación acotada. El techo de 200 no es capricho: sin él, un `?limit=1000000` desde el panel
 * baja la API para todos los tenants, que es un problema mucho peor que ver una página de menos.
 */
function paginate(f: { limit?: string | number; offset?: string | number }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const offset = Math.max(Number(f.offset) || 0, 0);
  return { limit, offset };
}

/** `[{code, status, n}]` → `[{code, name, total, by_status}]`, que es como lo dibuja el panel. */
function groupPlans(rows: { code: string; name: string; status: string; n: number }[]) {
  const byCode = new Map<string, { code: string; name: string; total: number; by_status: Record<string, number> }>();
  for (const r of rows) {
    const entry = byCode.get(r.code) ?? { code: r.code, name: r.name, total: 0, by_status: {} };
    entry.total += r.n;
    entry.by_status[r.status] = (entry.by_status[r.status] ?? 0) + r.n;
    byCode.set(r.code, entry);
  }
  return [...byCode.values()];
}
