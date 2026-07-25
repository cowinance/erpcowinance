/**
 * Aislamiento por tenant (RLS) — FUENTE ÚNICA de las tablas protegidas y de la política.
 *
 * Vive fuera de `DbService` porque lo consumen DOS caminos que deben aplicar EXACTAMENTE lo
 * mismo: el arranque de la app (PGlite en dev) y la verificación contra PostgreSQL real
 * (`npm run verify:rls`). Si esto se duplicara, la verificación podría pasar sobre políticas
 * distintas de las que corren en producción — justo lo que se quiere evitar.
 */

/** Tablas con la política estándar `tenant_isolation` sobre `app.tenant_id`. */
export const RLS_TABLES = [
  'companies',
  'farms',
  'animals',
  'animal_identifiers',
  'animal_breeds',
  'animal_events',
  // Movimientos de hacienda (P3): tabla-fact activa (recordMovement). Sin RLS quedaba fuera del
  // backstop tenant que tienen el resto de las tablas de hechos (aunque las queries ya filtran).
  'animal_movements',
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
  'repro_protocol_assignment_animals',
  'subscriptions',
  'inventory_categories',
  'inventory_items',
  'warehouses',
  'stock_movements',
  'stock_levels',
  'inventory_batches',
  // Comercial (C-1): maestro de socios + compras/ventas (tablas dormidas activadas).
  'business_partners',
  'partner_interactions',
  'opportunities',
  'opportunity_stage_events',
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
  // A3 (Configuración): banderas de funcionalidad por tenant (tabla dormida activada).
  'feature_flags',
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
  // H-2: liquidaciones de sueldos.
  'payroll_runs',
  'payroll_items',
  // AG-1: cultivos (sobre paddocks).
  'crops',
  // AG-2: labores (consumo de insumos) + cosechas.
  'crop_operations',
  'harvests',
  // MQ-1: maquinaria (maestro).
  'machinery',
  // MQ-2: mantenimiento + combustible.
  'maintenance_records',
  'fuel_logs',
  // G-1: partidas de semen (pajuelas).
  'semen_batches',
  // G-2b: embriones + evaluaciones genéticas.
  'embryos',
  'genetic_evaluations',
  // T-1: guías de traslado de hacienda.
  'movement_guides',
  // T-2: certificaciones (polimórficas).
  'certifications',
  // BG-1: presupuestos (extensión de Finanzas).
  'budgets',
  'budget_lines',
  // FA-1: faena (res por animal).
  'carcass_records',
  // PG-1: pastoreo (rotación de lotes por potrero).
  'grazing_records',
  // TB-1: tambo — tanques + producción diaria por vaca.
  'milk_tanks',
  'milk_production_daily',
  // TB-2: entregas de leche + tests de calidad.
  'milk_deliveries',
  'milk_quality_tests',
  // WL-1: partes de trabajo (horas de empleado). El esquema traía su policy
  // dispersa sobre app.current_tenant; acá recibe la estándar sobre app.tenant_id.
  'work_logs',
  // LAB-1: laboratorio — maestro + muestras + resultados (tablas dormidas activadas).
  'labs',
  'lab_samples',
  'lab_results',
  'lots',
  'paddocks',
  'products_veterinary',
  // Sanidad E2: casos clínicos + su timeline.
  'clinical_cases',
  'clinical_case_events',
  // Sanidad E6: internaciones hospital/cuarentena.
  'health_admissions',
  'alerts',
  'alert_rules',
  'notifications',
  // notification_deliveries NO va acá: tiene política bespoke (tenant + excepción
  // app.job_scope='push_worker'), definida en la migración junto a la tabla (P7-3.b).
  'files',
  'attachments',
  'documents',
  'tasks',
  'task_events',
  'task_recurrences',
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

  // ── Dormidas: ningún servicio las escribe TODAVÍA (fases futuras) ──────────────────────
  // Se les da la política estándar igual. Motivo: el DDL canónico las deja con una policy sobre
  // `app.current_tenant` (deny-all para el rol de servicio), así que al activar el módulo el
  // síntoma sería un "no devuelve nada" desconcertante… o peor, alguien la desactiva sin
  // reemplazarla y quedan SIN aislamiento. Protegidas desde el día uno, activarlas no requiere
  // acordarse de nada. Si alguna necesitara acceso cross-tenant de un worker, será una excepción
  // explícita y documentada (como import_batches), no un descuido.
  'ai_conversations',
  'ai_messages',
  'image_analyses',
  'predictions',
  'blockchain_anchors',
  'verifiable_credentials',
  'api_keys',
  'webhooks',
  'webhook_deliveries',
  'integrations',
  'marketplace_listings',
  'marketplace_inquiries',
  'marketplace_media',
  'marketplace_transactions',
  'course_enrollments',
  'course_modules',
  'sensor_readings',
  'gps_positions',
  'geofences',
  'soil_analyses',
  'shearing_records',
  'storage_tanks',
  'cryo_canisters',
  'cryo_goblets',
  'compliance_reports',
  'contracts',
  'audit_logs',
  'invitations',
  'devices',
  'assets',
  'billing_payments',
  'subscription_usage',
  'notification_preferences',
  'trace_events',
];

/**
 * RLS activa y FORZADA (PGlite conecta como owner de las tablas; sin FORCE
 * el owner la saltea). La política compara tenant_id con la variable de
 * sesión app.tenant_id, que el interceptor de auth fija por request con
 * SET LOCAL dentro de la transacción. Sin variable → cero filas.
 *
 * Cada tabla recibe además un DROP de la policy `tenant_isolation_<tabla>` que trae el DDL
 * canónico: usa `current_setting('app.current_tenant')`, variable que la app NUNCA fija (usa
 * `app.tenant_id`), así que para un rol NO privilegiado equivale a DENY-ALL. Antes se borraba a
 * mano, tabla por tabla, al activar cada módulo (33 líneas sueltas acumuladas, y una trampa
 * esperando al siguiente); ahora va en el mismo template que crea la policy correcta, así no hay
 * nada que recordar. Las policies BESPOKE (import_batches, notification_deliveries) se llaman
 * `tenant_isolation` SIN sufijo y no están en esta lista → no se tocan.
 *
 * `only` acota a un subconjunto (mismo template, sin duplicarlo): lo usa `verify:rls`, que corre
 * sobre el DDL canónico y por eso no tiene las tablas que la app crea en migraciones de arranque.
 */
export function rlsMigration(only?: readonly string[]): string {
  const targets = only ? RLS_TABLES.filter((t) => only.includes(t)) : RLS_TABLES;
  return targets.map(
  (t) => `
      ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";
      DROP POLICY IF EXISTS tenant_isolation ON "${t}";
      CREATE POLICY tenant_isolation ON "${t}"
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
  ).join('\n');
}
