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
  'cryo_straws',
  'repro_service_plans',
  'cryo_nitrogen_readings',
  'cryo_nitrogen_refills',
  'fiscal_series',
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
/**
 * El tenant de la sesión, como expresión SQL para las policies.
 *
 * **El `NULLIF` no es cosmético: sin él la app se cae en producción y no en desarrollo.**
 *
 * PostgreSQL NO "desfija" un GUC personalizado al terminar la transacción: después de un
 * `SET LOCAL app.tenant_id = …`, al cerrar la tx el parámetro vuelve a **cadena vacía**, no a
 * indefinido. Comprobado contra PostgreSQL 17:
 *
 *   antes de cualquier SET      → current_setting('app.tenant_id', true) = NULL   → NULL::uuid, OK
 *   después de un SET LOCAL     → current_setting('app.tenant_id', true) = ''     → ''::uuid, ERROR
 *
 * Con PGlite eso nunca se ve: hay UNA sola conexión y el arranque le fija un valor real. Con
 * PostgreSQL real hay un POOL, así que toda conexión que ya atendió una request autenticada queda
 * devolviendo `''` para siempre. Cualquier consulta posterior FUERA de una request —el worker de
 * importación, que sondea cada 2 segundos— toma una de esas conexiones y muere con
 * «invalid input syntax for type uuid: ""».
 *
 * Es exactamente el fallo que tenía trabado el workflow de Release: la API no terminaba de
 * levantar y `readyz` nunca respondía.
 *
 * `NULLIF(…, '')` devuelve NULL para la cadena vacía, y comparar contra NULL no da filas: sin
 * tenant no se ve nada, que es el fail-closed que se busca.
 */
const TENANT_GUC = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

export function rlsMigration(only?: readonly string[]): string {
  const targets = only ? RLS_TABLES.filter((t) => only.includes(t)) : RLS_TABLES;
  return targets.map(
  (t) => `
      ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_${t} ON "${t}";
      DROP POLICY IF EXISTS tenant_isolation ON "${t}";
      CREATE POLICY tenant_isolation ON "${t}"
        USING (tenant_id = ${TENANT_GUC})
        WITH CHECK (tenant_id = ${TENANT_GUC});`,
  ).join('\n');
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// PLANO DE PLATAFORMA — lectura cross-tenant para el panel del dueño de Cowinance.
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * El GUC que habilita la lectura global. Lo fija SOLO `PlatformDb` (módulo `platform`), con
 * `SET LOCAL` dentro de su propia transacción.
 *
 * Fail-closed en los dos estados posibles fuera de esa transacción, que es lo que lo hace seguro
 * en un POOL: antes de cualquier `SET` vale NULL (`NULL = 'on'` → NULL, no da filas) y después de
 * una transacción que lo fijó vuelve a cadena vacía (`'' = 'on'` → false). Es el mismo residuo que
 * obligó al `NULLIF` de `app.tenant_id` (ver TENANT_GUC), pero acá no hace falta: comparar contra
 * un literal ya descarta ambos casos sin castear nada.
 */
const PLATFORM_GUC = `current_setting('app.platform_read', true) = 'on'`;

/**
 * Tablas de tenant que el panel de plataforma puede leer A TRAVÉS de los tenants.
 *
 * **Es una lista corta a propósito, y ese es el diseño.** La alternativa obvia —dejar leer las
 * ~150 de `RLS_TABLES`— convertiría al panel en una ventana a los datos operativos de cada finca:
 * historia sanitaria, precios de venta, sueldos. Nada de eso hace falta para administrar cuentas.
 *
 * El criterio para entrar acá es «¿lo necesita el negocio de Cowinance para operar la plataforma?»:
 * cuántas fincas hay, cuántos animales/usuarios/dispositivos tiene cada una (que es lo que se
 * factura), qué plan tiene y cuánto almacenamiento consume. Los CONTENIDOS quedan afuera.
 *
 * Consecuencia deliberada: la «actividad reciente» del detalle de organización se deriva de estas
 * tablas (últimas altas de animales, última subida de archivo, último sync, último login) y NO de
 * `animal_events`/`health_events`/`sales`. Es señal de si la cuenta está viva, no un espejo de la
 * finca. Agregar una tabla acá tiene que ser una decisión, no un descuido.
 */
export const PLATFORM_READ_TABLES = [
  'companies',
  'farms',
  'animals',
  'subscriptions',
  'subscription_usage',
  'billing_payments',
  'files',
  'sync_devices',
];

/** Tablas del plano de plataforma: no son de tenant, y solo se ven con el GUC puesto. */
export const PLATFORM_TABLES = ['platform_admins', 'platform_audit_logs'];

/**
 * Policies del plano de plataforma. CONVERGENTE como `rlsMigration()`: se re-aplica en cada
 * arranque y se genera desde las listas de arriba, así agregar una tabla a `PLATFORM_READ_TABLES`
 * crea su policy sola.
 *
 * Dos formas distintas, y la diferencia importa:
 *
 *  · Sobre las tablas de TENANT se agrega una policy PERMISIVA `FOR SELECT`. Las permisivas se
 *    OR-ean, así que `tenant_isolation` queda intacta: una sesión de tenant sigue viendo lo suyo y
 *    nada más. Y al ser `FOR SELECT`, el panel **no puede escribir cross-tenant aunque el código
 *    lo intente** — `INSERT`/`UPDATE`/`DELETE` siguen pasando solo por `tenant_isolation`, que
 *    exige un `app.tenant_id` que el plano de plataforma nunca fija. La fase 1 es de solo lectura
 *    porque el motor no permite otra cosa, no porque los servicios se porten bien.
 *
 *  · Sobre las tablas PROPIAS del plano la policy es total (sin `FOR`), porque la bitácora sí se
 *    escribe. Ahí el aislamiento va al revés: sin el GUC no se ve ni se escribe nada, de modo que
 *    desde el ERP `platform_admins` y `platform_audit_logs` no existen.
 */
export function platformMigration(): string {
  const readOnly = PLATFORM_READ_TABLES.map(
    (t) => `
      DROP POLICY IF EXISTS platform_read ON "${t}";
      CREATE POLICY platform_read ON "${t}" FOR SELECT
        USING (${PLATFORM_GUC});`,
  );
  const own = PLATFORM_TABLES.map(
    (t) => `
      ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS platform_only ON "${t}";
      CREATE POLICY platform_only ON "${t}"
        USING (${PLATFORM_GUC})
        WITH CHECK (${PLATFORM_GUC});`,
  );
  return [...readOnly, ...own].join('\n');
}
