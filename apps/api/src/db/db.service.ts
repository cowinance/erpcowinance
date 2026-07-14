import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { bootstrapCatalogs, seedDemo } from './seed';
import { requestContext } from '../common/request-context';
import type { Q } from './query';

// Re-exportado para no romper a los consumidores que ya importan Q desde aquí.
export type { Q } from './query';

/**
 * Capa de persistencia (dev): PGlite = PostgreSQL embebido en proceso.
 * Carga el DDL canónico completo (140 tablas, packages/db/cowinance_schema.sql).
 * En producción el mismo DDL corre sobre PostgreSQL 17 + PostGIS + TimescaleDB;
 * aquí los tipos geography se degradan a jsonb (PGlite no soporta PostGIS).
 */
@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private db!: PGlite;
  private tenantId!: string;
  private farmId!: string;
  private userId!: string;

  /**
   * Infra dev v0 (pendiente de incorporar al DDL canónico): cursor global de
   * changesets, versiones HLC por campo (LWW), credenciales de login,
   * refresh tokens con rotación, y outbox de eventos de dominio (F5).
   */
  private static readonly SYNC_MIGRATION = `
    CREATE SEQUENCE IF NOT EXISTS sync_changesets_server_seq;
    ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS server_seq bigint DEFAULT nextval('sync_changesets_server_seq');
    CREATE INDEX IF NOT EXISTS ix_sync_changesets_server_seq ON sync_changesets (tenant_id, server_seq);
    -- Changesets de origen servidor (P2 oleada 2.2, ADR-0016): habilita propagar
    -- entidades creadas server-side (importación) a dispositivos ya bootstrapeados,
    -- vía pull, SIN dispositivo ni secuencia sintéticos. Para source='server',
    -- sync_device_id y seq son NULL (seq NO se falsea); la idempotencia la da
    -- (tenant_id, origin_ref). El CHECK prohíbe estados híbridos. Orden deliberado:
    -- se rellena la columna source (default 'device') ANTES del CHECK, así las
    -- filas existentes (todas device) ya satisfacen la forma válida. CHECK idempotente
    -- por drop+add (sin plpgsql; PGlite-safe). Esta migración NO inserta filas
    -- server (eso llega con el procesador) y NO toca el pull ni los tipos remotos
    -- (commit 2.3).
    ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'device';
    ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS origin_ref varchar(128);
    ALTER TABLE sync_changesets ALTER COLUMN sync_device_id DROP NOT NULL;
    ALTER TABLE sync_changesets ALTER COLUMN seq DROP NOT NULL;
    ALTER TABLE sync_changesets DROP CONSTRAINT IF EXISTS ck_sync_changesets_source_shape;
    ALTER TABLE sync_changesets ADD CONSTRAINT ck_sync_changesets_source_shape CHECK (
      (source = 'device' AND sync_device_id IS NOT NULL AND seq IS NOT NULL AND origin_ref IS NULL)
      OR
      (source = 'server' AND sync_device_id IS NULL AND seq IS NULL AND origin_ref IS NOT NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_changesets_server_origin
      ON sync_changesets (tenant_id, origin_ref) WHERE source = 'server';
    ALTER TABLE sync_conflicts ADD COLUMN IF NOT EXISTS detail text;
    CREATE TABLE IF NOT EXISTS sync_row_state (
      tenant_id uuid NOT NULL,
      table_name varchar(255) NOT NULL,
      row_id uuid NOT NULL,
      versions jsonb DEFAULT '{}' NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      PRIMARY KEY (tenant_id, table_name, row_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255);
    -- Verificación de email (P1.1): la columna existe desde ya; el envío y la
    -- exposición en el token/perfil son P1.2. auth no la lee todavía.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      jti uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      expires_at timestamptz NOT NULL,
      rotated_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL
    );
    -- Tokens de acción por email (P1.2, ADR-0011): verificación de email y reset
    -- de contraseña. SIN RLS a propósito (plano de identidad, como users y
    -- auth_refresh_tokens): se consumen en flujos @Public sin contexto de tenant,
    -- resueltos por user_id embebido en la fila. Se guarda el HASH del token, no
    -- el token en claro (que viaja solo en el email). Un solo token vivo por
    -- (user, purpose): issue() supersede los previos. Single-use vía consumed_at.
    CREATE TABLE IF NOT EXISTS email_action_tokens (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      purpose varchar(32) NOT NULL,
      token_hash varchar(64) NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_email_action_tokens_hash ON email_action_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS ix_email_action_tokens_user ON email_action_tokens (user_id, purpose);
    -- Outbox de eventos de dominio (F5, ADR-0005). Sin RLS a propósito (como
    -- auth_refresh_tokens): el relay es un proceso interno de confianza que
    -- drena cross-tenant post-commit. tenant_id se guarda para trazabilidad.
    CREATE TABLE IF NOT EXISTS event_outbox (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      type varchar(255) NOT NULL,
      payload jsonb NOT NULL,
      occurred_at timestamptz NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      published_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS ix_event_outbox_unpublished ON event_outbox (created_at) WHERE published_at IS NULL;
  `;

  /**
   * Migración de datos del ERP (P2 oleada 2.4, ADR-0016 relacionado). Dos tablas:
   *  - import_batches: cabecera del job. RLS forzada + excepción de DESCUBRIMIENTO
   *    (`app.job_scope='import_worker'`) para que el futuro procesador reclame
   *    trabajo cross-tenant; ningún path de request fija ese GUC.
   *  - import_rows: filas del archivo (dato del cliente). RLS estándar por
   *    app.tenant_id (está en RLS_TABLES; la política la aplica rlsMigration).
   * FK COMPUESTA multi-tenant (tenant_id, batch_id) -> (tenant_id, id): impide
   * estructuralmente asociar una fila a un batch de otro tenant, aun ante un bug
   * de código. SIN ON DELETE CASCADE (política de borrado de batches indefinida).
   * `tenant_id` redundante en import_rows es deliberado: defensa estructural.
   * Idempotente: la UNIQUE(tenant_id,id) la referencia la FK, así que se dropea
   * primero la FK y luego la UNIQUE antes de re-crearlas (orden de dependencia;
   * sin plpgsql). Esta oleada NO crea ImportClaimRepository, endpoints, procesador
   * ni filas reales.
   */
  private static readonly IMPORT_MIGRATION = `
    CREATE TABLE IF NOT EXISTS import_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      entity_type varchar(64) NOT NULL DEFAULT 'animal',
      source_filename varchar(255),
      file_ref varchar(255),
      mapping jsonb,
      reconcile_mode varchar(32) NOT NULL DEFAULT 'create_skip_duplicates',
      status varchar(32) NOT NULL DEFAULT 'uploaded',
      phase varchar(16),
      total_rows int NOT NULL DEFAULT 0,
      created_count int NOT NULL DEFAULT 0,
      skipped_count int NOT NULL DEFAULT 0,
      invalid_count int NOT NULL DEFAULT 0,
      error_count int NOT NULL DEFAULT 0,
      heartbeat_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS ck_import_batches_status;
    ALTER TABLE import_batches ADD CONSTRAINT ck_import_batches_status CHECK (
      status IN ('uploaded','mapped','previewed','queued','processing','completed','completed_with_errors','failed'));
    CREATE INDEX IF NOT EXISTS ix_import_batches_discovery ON import_batches (status, created_at);

    CREATE TABLE IF NOT EXISTS import_rows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      batch_id uuid NOT NULL,
      row_number int NOT NULL,
      raw jsonb NOT NULL,
      normalized jsonb,
      status varchar(16) NOT NULL DEFAULT 'pending',
      skip_reason varchar(64),
      errors jsonb,
      warnings jsonb,
      resulting_entity_id uuid,
      processed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (batch_id, row_number)
    );
    ALTER TABLE import_rows DROP CONSTRAINT IF EXISTS ck_import_rows_status;
    ALTER TABLE import_rows ADD CONSTRAINT ck_import_rows_status CHECK (
      status IN ('pending','created','skipped','invalid','error'));
    CREATE INDEX IF NOT EXISTS ix_import_rows_batch ON import_rows (batch_id, row_number);

    -- FK compuesta y su UNIQUE de respaldo (orden de dependencia: FK primero al dropear).
    ALTER TABLE import_rows DROP CONSTRAINT IF EXISTS fk_import_rows_batch;
    ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS uq_import_batches_tenant_id_id;
    ALTER TABLE import_batches ADD CONSTRAINT uq_import_batches_tenant_id_id UNIQUE (tenant_id, id);
    ALTER TABLE import_rows ADD CONSTRAINT fk_import_rows_batch
      FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id);

    -- RLS de import_batches: tenant + excepción de descubrimiento del worker.
    -- import_rows recibe la política estándar vía rlsMigration (RLS_TABLES).
    ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON import_batches;
    CREATE POLICY tenant_isolation ON import_batches
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid
             OR current_setting('app.job_scope', true) = 'import_worker')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
                  OR current_setting('app.job_scope', true) = 'import_worker');
  `;

  /**
   * M-1.a (P3): columnas aditivas de `animal_movements` para el núcleo neutral de
   * movimientos — `origin` (procedencia: web/map/sync) y `movement_id` (clave de
   * idempotencia por operación). El índice único PARCIAL (movement_id NOT NULL)
   * garantiza un solo hecho por (operación, animal) ante reproceso de changeset o
   * reintento REST, sin chocar con las filas heredadas (movement_id NULL).
   */
  private static readonly MOVEMENT_MIGRATION = `
    ALTER TABLE animal_movements ADD COLUMN IF NOT EXISTS origin varchar(16);
    ALTER TABLE animal_movements ADD COLUMN IF NOT EXISTS movement_id uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_animal_movements_movement
      ON animal_movements (tenant_id, movement_id, animal_id) WHERE movement_id IS NOT NULL;

    -- Deduplicación de notificaciones (P7-1): una entrega por (usuario, canal, alerta). Incluye
    -- channel para no colisionar entre in_app y push sobre la misma alerta en el futuro.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_alert_user
      ON notifications (tenant_id, user_id, channel, alert_id) WHERE alert_id IS NOT NULL AND deleted_at IS NULL;

    -- Entregas push por dispositivo (P7-3): la notificación lógica push (notifications) es por
    -- usuario/alerta; cada dispositivo activo con token genera una entrega independiente, con su
    -- propio estado/reintentos/token_snapshot → se puede reintentar/invalidar solo el fallido y
    -- evitar dobles envíos por claim. RLS estándar vía RLS_TABLES.
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      tenant_id uuid NOT NULL,
      notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
      sync_device_id uuid NOT NULL REFERENCES sync_devices (id) ON DELETE CASCADE,
      token_snapshot varchar(255) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
      attempt_count int NOT NULL DEFAULT 0,
      next_attempt_at timestamptz,
      processing_at timestamptz,
      last_error text,
      sent_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_deliveries_device
      ON notification_deliveries (tenant_id, notification_id, sync_device_id);
    CREATE INDEX IF NOT EXISTS ix_notification_deliveries_claim
      ON notification_deliveries (status, next_attempt_at);

    -- Política RLS BESPOKE (P7-3.b), como import_batches: tenant normal + EXCEPCIÓN de
    -- descubrimiento del worker de push (app.job_scope='push_worker'), que el
    -- PushDeliveryClaimRepository fija SOLO en su tx de reclamo. Por eso NO va en RLS_TABLES.
    ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON notification_deliveries;
    CREATE POLICY tenant_isolation ON notification_deliveries
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid
             OR current_setting('app.job_scope', true) = 'push_worker')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
                  OR current_setting('app.job_scope', true) = 'push_worker');
  `;

  private static readonly WEIGHING_PROJECTION_MIGRATION = `
    CREATE INDEX IF NOT EXISTS ix_weighings_tenant_animal_weighed_at
      ON weighings (tenant_id, animal_id, weighed_at);
    DROP VIEW IF EXISTS v_weighings;
    CREATE VIEW v_weighings AS
      SELECT ranked.id,
             ranked.tenant_id,
             ranked.animal_id,
             ranked.weighed_at,
             ranked.weight_kg,
             ranked.method,
             ranked.device_id,
             CASE
               WHEN ranked.prev_weight_kg IS NULL THEN NULL
               ELSE ROUND(
                 (ranked.weight_kg - ranked.prev_weight_kg)
                 / GREATEST(1::numeric, EXTRACT(EPOCH FROM (ranked.weighed_at - ranked.prev_weighed_at))::numeric / 86400),
                 3
               )::numeric(14,3)
             END AS adg_since_last,
             ranked.body_condition,
             ranked.created_at,
             ranked.updated_at,
             ranked.created_by,
             ranked.deleted_at
      FROM (
        SELECT w.*,
               LAG(w.weight_kg) OVER (
                 PARTITION BY w.tenant_id, w.animal_id
                 ORDER BY w.weighed_at, w.created_at, w.id
               ) AS prev_weight_kg,
               LAG(w.weighed_at) OVER (
                 PARTITION BY w.tenant_id, w.animal_id
                 ORDER BY w.weighed_at, w.created_at, w.id
               ) AS prev_weighed_at
        FROM weighings w
        WHERE w.deleted_at IS NULL
      ) ranked;
  `;

  /** Asignaciones de protocolo reproductivo a un lote (R-2.b): materializan un protocolo IATF en
   *  tareas (P6). Tabla nueva; RLS estándar vía RLS_TABLES. */
  private static readonly REPRO_ASSIGNMENTS_MIGRATION = `
    CREATE TABLE IF NOT EXISTS repro_protocol_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      protocol_id uuid NOT NULL REFERENCES repro_protocols(id) ON DELETE RESTRICT,
      lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
      start_date date NOT NULL,
      animal_count int NOT NULL DEFAULT 0,
      status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS ix_repro_assignments_tenant ON repro_protocol_assignments (tenant_id, status);
  `;

  /** Tablas de dominio con aislamiento por tenant vía Row-Level Security. */
  private static readonly RLS_TABLES = [
    'companies',
    'farms',
    'animals',
    'animal_identifiers',
    'animal_breeds',
    'animal_events',
    'weighings',
    'treatments',
    'vaccinations',
    'health_events',
    'health_plans',
    'mortalities',
    'breeding_events',
    'pregnancies',
    'calvings',
    'calving_offspring',
    'weanings',
    'repro_protocols',
    'repro_protocol_assignments',
    'subscriptions',
    'inventory_categories',
    'inventory_items',
    'warehouses',
    'stock_movements',
    'stock_levels',
    'inventory_batches',
    // Comercial (C-1): maestro de socios + compras/ventas (tablas dormidas activadas).
    'business_partners',
    'suppliers',
    'customers',
    'contacts',
    'price_lists',
    'purchases',
    'purchase_lines',
    'sales',
    'sale_lines',
    // Finanzas (F-1): libro mayor core (tablas dormidas activadas).
    'chart_of_accounts',
    'fiscal_periods',
    'cost_centers',
    'journal_entries',
    'journal_lines',
    // F-2: mapa de cuentas de posteo (k/v por company).
    'system_settings',
    // F-3a: facturas (documento fiscal ligado a venta/compra).
    'invoices',
    // F-3b: pagos + imputaciones + cuentas bancarias.
    'payments',
    'payment_allocations',
    'bank_accounts',
    // N-1: raciones (fórmula + ingredientes de inventario).
    'rations',
    'ration_ingredients',
    // N-2: entregas de alimento a lote (consumo de stock).
    'feed_deliveries',
    // H-1: empleados (maestro de RRHH).
    'employees',
    'lots',
    'paddocks',
    'products_veterinary',
    'alerts',
    'alert_rules',
    'notifications',
    // notification_deliveries NO va acá: tiene política bespoke (tenant + excepción
    // app.job_scope='push_worker'), definida en la migración junto a la tabla (P7-3.b).
    'files',
    'attachments',
    'documents',
    'tasks',
    'calendar_events',
    // user_role_assignments queda SIN RLS: el login resuelve el tenant del
    // usuario ANTES de tener contexto de tenant (plano de identidad)
    'sync_devices',
    'sync_changesets',
    'sync_conflicts',
    'sync_row_state',
    // import_rows: política estándar por tenant. import_batches NO va aquí: lleva
    // una política bespoke (tenant + excepción app.job_scope) en IMPORT_MIGRATION.
    'import_rows',
  ];

  /**
   * RLS activa y FORZADA (PGlite conecta como owner de las tablas; sin FORCE
   * el owner la saltea). La política compara tenant_id con la variable de
   * sesión app.tenant_id, que el interceptor de auth fija por request con
   * SET LOCAL dentro de la transacción. Sin variable → cero filas.
   */
  private static rlsMigration(): string {
    return DbService.RLS_TABLES.map(
      (t) => `
        ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON "${t}";
        CREATE POLICY tenant_isolation ON "${t}"
          USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
    ).join('\n');
  }

  async onModuleInit() {
    const dataDir = join(process.cwd(), '.data', 'pglite');
    mkdirSync(dataDir, { recursive: true });
    this.db = new PGlite(dataDir);
    await this.db.waitReady;
    const has = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'`,
    );
    if (has.rows[0].n === 0) {
      this.logger.log('Base vacía: cargando esquema canónico (140 tablas)…');
      await this.db.exec(this.loadSchemaSql());
      this.logger.log('Esquema cargado.');
    }
    await this.db.exec(DbService.SYNC_MIGRATION);
    // Tablas de import ANTES de rlsMigration: import_rows debe existir para que la
    // política estándar (RLS_TABLES) se le aplique; import_batches trae su propia
    // política bespoke dentro de IMPORT_MIGRATION.
    await this.db.exec(DbService.IMPORT_MIGRATION);
    await this.db.exec(DbService.MOVEMENT_MIGRATION);
    await this.db.exec(DbService.WEIGHING_PROJECTION_MIGRATION);
    await this.db.exec(DbService.REPRO_ASSIGNMENTS_MIGRATION);
    // R-2.a: el esquema canónico traía una policy dispersa sobre `app.current_tenant` (que la app
    // NUNCA setea → denegaba en prod). Se elimina; `repro_protocols` ya está en RLS_TABLES y recibe
    // la policy estándar `tenant_isolation` sobre `app.tenant_id` en rlsMigration.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_repro_protocols ON "repro_protocols";');
    // B-1: misma policy dispersa (app.current_tenant) en subscriptions → se elimina; ya está en
    // RLS_TABLES y recibe la estándar sobre app.tenant_id.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_subscriptions ON "subscriptions";');
    // INV-1: mismas policies dispersas (app.current_tenant) en las tablas de inventario activadas.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_inventory_categories ON "inventory_categories";');
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_inventory_items ON "inventory_items";');
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_warehouses ON "warehouses";');
    // INV-2a: mismas policies dispersas en las tablas de kardex/existencias.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_stock_movements ON "stock_movements";');
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_stock_levels ON "stock_levels";');
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_inventory_batches ON "inventory_batches";');
    // C-1: mismas policies dispersas (app.current_tenant) en las 9 tablas comerciales activadas.
    for (const t of ['business_partners', 'suppliers', 'customers', 'contacts', 'price_lists', 'purchases', 'purchase_lines', 'sales', 'sale_lines']) {
      await this.db.exec(`DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";`);
    }
    // F-1: mismas policies dispersas en las 5 tablas del libro mayor.
    for (const t of ['chart_of_accounts', 'fiscal_periods', 'cost_centers', 'journal_entries', 'journal_lines']) {
      await this.db.exec(`DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";`);
    }
    // F-2: misma policy dispersa en system_settings (mapa de cuentas de posteo).
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_system_settings ON "system_settings";');
    // F-3a: misma policy dispersa en invoices.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_invoices ON "invoices";');
    // F-3b: mismas policies dispersas en pagos/imputaciones/bancos.
    for (const t of ['payments', 'payment_allocations', 'bank_accounts']) {
      await this.db.exec(`DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";`);
    }
    // N-1: mismas policies dispersas en raciones e ingredientes.
    for (const t of ['rations', 'ration_ingredients']) {
      await this.db.exec(`DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";`);
    }
    // N-2: misma policy dispersa en feed_deliveries.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_feed_deliveries ON "feed_deliveries";');
    // H-1: misma policy dispersa en employees.
    await this.db.exec('DROP POLICY IF EXISTS tenant_isolation_employees ON "employees";');
    await this.db.exec(DbService.rlsMigration());

    // Catálogos base + roles de sistema: SIEMPRE (idempotente). Una finca que
    // se registra self-service (P1.1) depende de que el rol `owner` exista.
    await this.runInTx(() => bootstrapCatalogs(this.db), 'Cargando catálogos base…');

    // Datos demo: solo bajo SEED_DEMO (ON en dev, OFF en prod) y si la base no
    // tiene organizaciones todavía. Sin demo, el sistema arranca vacío y espera
    // el primer registro real.
    const orgs = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM organizations`);
    if (orgs.rows[0].n === 0 && DbService.seedDemoEnabled()) {
      await this.runInTx(() => seedDemo(this.db), 'Sembrando datos demo…');
      this.logger.log('Seed demo completado.');
    }

    // Contexto por defecto para código fuera de request (boot, jobs). Con
    // SEED_DEMO off y sin registros aún, la base está vacía: no hay contexto por
    // defecto y toda operación pasa por el flujo de request (register/login).
    const org = await this.db.query<{ id: string }>(
      `SELECT id FROM organizations ORDER BY created_at LIMIT 1`,
    );
    if (!org.rows[0]) {
      this.logger.log(
        `Base sin organizaciones (SEED_DEMO off): esperando registro self-service. RLS forzada en ${DbService.RLS_TABLES.length} tablas.`,
      );
      return;
    }
    this.tenantId = org.rows[0].id;
    // GUC de sesión: contexto por defecto para código fuera de request
    // (boot, seed). Las requests lo pisan con SET LOCAL en su transacción.
    await this.db.query(`SELECT set_config('app.tenant_id', $1, false)`, [this.tenantId]);
    const farm = await this.db.query<{ id: string }>(
      `SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [this.tenantId],
    );
    this.farmId = farm.rows[0]?.id;
    const user = await this.db.query<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
    this.userId = user.rows[0].id;
    this.logger.log(`Contexto dev: tenant=${this.tenantId} farm=${this.farmId} · RLS forzada en ${DbService.RLS_TABLES.length} tablas`);
  }

  /** ¿Sembrar datos demo? ON en dev por defecto, OFF en producción. Override con SEED_DEMO. */
  private static seedDemoEnabled(): boolean {
    const flag = process.env.SEED_DEMO?.trim().toLowerCase();
    if (flag) return ['1', 'true', 'on', 'yes'].includes(flag);
    return process.env.NODE_ENV !== 'production';
  }

  /** Ejecuta `fn` dentro de una transacción PGlite (BEGIN/COMMIT, ROLLBACK si lanza). */
  private async runInTx(fn: () => Promise<void>, log?: string): Promise<void> {
    if (log) this.logger.log(log);
    await this.db.exec('BEGIN');
    try {
      await fn();
      await this.db.exec('COMMIT');
    } catch (err) {
      await this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private loadSchemaSql(): string {
    const candidates = [
      resolve(process.cwd(), '../../packages/db/cowinance_schema.sql'),
      resolve(__dirname, '../../../../packages/db/cowinance_schema.sql'),
    ];
    const path = candidates.find((p) => existsSync(p));
    if (!path) throw new Error('No se encontró packages/db/cowinance_schema.sql');
    const raw = readFileSync(path, 'utf8');
    return raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('CREATE EXTENSION'))
      .join('\n')
      .replace(/geography\([^)]*\)/g, 'jsonb');
  }

  /** Tenant del actor: contexto de la request autenticada, o el default de boot (seed/jobs). */
  get tenant(): string {
    return requestContext.getStore()?.tenantId ?? this.tenantId;
  }
  get user(): string {
    return requestContext.getStore()?.userId ?? this.userId;
  }
  /** Finca por defecto del tenant de boot (solo seed); las requests usan defaultFarm(). */
  get farm(): string {
    return this.farmId;
  }

  private farmCache = new Map<string, string>();
  /** Primera finca del tenant actual (v0: finca única por tenant). */
  async defaultFarm(): Promise<string> {
    const t = this.tenant;
    const cached = this.farmCache.get(t);
    if (cached) return cached;
    const farm = await this.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]);
    if (!farm) throw new Error(`El tenant ${t} no tiene fincas`);
    this.farmCache.set(t, farm.id);
    return farm.id;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    // Dentro de una request autenticada, todo va por su transacción (RLS activa)
    const q = requestContext.getStore()?.q;
    if (q) return q.query<T>(sql, params);
    const res = await this.db.query<T>(sql, params);
    return res.rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /**
   * Transacción real de PGlite: serializa el acceso a la conexión única
   * (otras requests esperan) y hace rollback automático si el callback lanza.
   * Nunca usar BEGIN/COMMIT manuales: con la conexión compartida, las queries
   * de otras requests se intercalarían dentro de la transacción ajena.
   */
  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    // Si la request ya corre dentro de su transacción (interceptor de auth),
    // se reutiliza: PGlite no soporta transacciones anidadas.
    const existing = requestContext.getStore()?.q;
    if (existing) return fn(existing);
    return this.db.transaction(async (t) => {
      const q: Q = {
        query: async <R>(sql: string, params?: unknown[]) => (await t.query<R>(sql, params)).rows,
        one: async <R>(sql: string, params?: unknown[]) => (await t.query<R>(sql, params)).rows[0],
      };
      return fn(q);
    });
  }
}
