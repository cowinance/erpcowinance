import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from './db.service';

/**
 * GUARDARRAÍL DE RLS (auditoría, Fase 1). Cierra una clase entera de bug: una tabla con `tenant_id`
 * que se activa (o se crea nueva) SIN política de aislamiento por tenant → fuga cross-tenant en prod
 * (en dev el superusuario NO enforce RLS, así que el bug pasa desapercibido hasta producción).
 *
 * La regla: TODA tabla base con columna `tenant_id` DEBE tener RLS habilitada (rlsMigration la pone
 * vía RLS_TABLES) — salvo que esté en `RLS_EXEMPT`, la lista EXPLÍCITA y documentada de exclusiones
 * conscientes. Si este test falla al agregar/activar una tabla, la decisión es binaria y visible:
 *   • agregá la tabla a DbService.RLS_TABLES  (lo normal para datos de tenant), o
 *   • agregala a RLS_EXEMPT con su motivo    (dormida de fase futura / caso especial como el login).
 *
 * Señal fiable = existe la POLICY `tenant_isolation` (la que crea rlsMigration sobre RLS_TABLES).
 * `relrowsecurity` no sirve: el schema canónico habilita RLS en muchas tablas sin esa policy.
 * Las tablas con `tenant_id` NULLABLE (catálogos globales+tenant: breeds/diagnoses/roles…) se
 * excluyen a propósito: filtrar por tenant_id ocultaría las filas globales (tenant_id NULL).
 */

/**
 * Exclusiones CONSCIENTES de RLS (tienen tenant_id pero no política estándar). Al ACTIVAR cualquiera
 * de estas (que un servicio empiece a escribirla), moverla a RLS_TABLES y sacarla de acá.
 */
const RLS_EXEMPT = new Set<string>([
  // Especial: el login resuelve el tenant desde acá ANTES de tener app.tenant_id (no puede autofiltrarse).
  'user_role_assignments',
  // Dormidas — fases futuras, ningún servicio activo las escribe todavía:
  'ai_conversations', 'ai_messages', 'image_analyses', 'predictions', // IA/ML
  'blockchain_anchors', 'verifiable_credentials', // blockchain
  'api_keys', 'webhooks', 'webhook_deliveries', 'integrations', // integraciones
  'marketplace_inquiries', 'marketplace_listings', 'marketplace_media', 'marketplace_transactions', // marketplace
  'course_enrollments', 'course_modules', // academia
  'sensor_readings', 'gps_positions', 'geofences', // IoT/GPS
  'soil_analyses', 'shearing_records', 'storage_tanks', // features no-módulo / dormidas
  'compliance_reports', 'contracts', 'audit_logs', 'invitations', 'devices', 'assets', // dormidas varias
  'billing_payments', 'subscription_usage', // billing dormido
  'notification_preferences', // notificaciones (preferencias dormidas)
  'trace_events', // trazabilidad (traza fina dormida)
  // tenant_id NULLABLE = catálogos globales+tenant: filtrar por tenant ocultaría las filas globales.
  'breeds', 'diagnoses', 'roles', 'courses', 'exchange_rates', 'market_prices',
  // infra/auth: se leen ANTES del contexto de tenant o las procesa un worker.
  'auth_refresh_tokens', 'event_outbox',
]);

describe('RLS · guardarraíl de cobertura', () => {
  let db: DbService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'rls-guard-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'off';
    db = new DbService();
    await db.onModuleInit();
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('toda tabla base con tenant_id tiene RLS habilitada o está exenta a propósito', async () => {
    const tenantTables = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
         AND a.attname = 'tenant_id' AND NOT a.attisdropped`,
    );
    const rlsOn = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'`,
    );
    const rlsSet = new Set(rlsOn.map((r) => r.tablename));

    const gaps = tenantTables.map((r) => r.relname).filter((t) => !rlsSet.has(t) && !RLS_EXEMPT.has(t)).sort();
    // Si esto falla: una tabla con tenant_id no tiene RLS ni está exenta. Decisión consciente:
    //   → agregala a DbService.RLS_TABLES, o a RLS_EXEMPT (con motivo) si es dormida/especial.
    expect(gaps).toEqual([]);
  });

  it('animal_movements (P3, tabla-fact activa) tiene la policy tenant_isolation', async () => {
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'animal_movements' AND policyname = 'tenant_isolation'`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('las exenciones no incluyen tablas que YA tienen RLS (mantiene la lista honesta)', async () => {
    const rlsOn = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'`,
    );
    const rlsSet = new Set(rlsOn.map((r) => r.tablename));
    const redundant = [...RLS_EXEMPT].filter((t) => rlsSet.has(t));
    expect(redundant).toEqual([]); // si una exenta ya tiene RLS, sacala de RLS_EXEMPT
  });
});
