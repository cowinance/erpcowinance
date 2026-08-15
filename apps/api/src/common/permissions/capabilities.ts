/**
 * Catálogo de CAPACIDADES y el mapa ruta → capacidad.
 *
 * ## Por qué la unidad es la capacidad y no la ruta
 *
 * Una ACL por ruta serían 480 decisiones que se desincronizan con el primer endpoint nuevo: la
 * ruta 481 nace sin entrada y nadie se entera hasta que alguien ve lo que no debía. Acá una ruta
 * nueva cae bajo el prefijo de su capacidad y HEREDA el permiso; solo hay que declarar algo cuando
 * la ruta no encaja en ninguna, y de eso se encarga el test de cobertura.
 *
 * ## Por qué tampoco es el módulo
 *
 * Porque cuatro capacidades cortan POR DENTRO de un módulo, y una cruza de módulo:
 *
 *   sanidad     → indicar (recetar) · aplicar (registrar la dosis)
 *   inventario  → existencias (cuántas quedan) · valuación (cuánto cuestan)
 *   hr          → parte de trabajo · liquidación · legajo
 *   health/costs y health/consumption viven en sanidad pero son PLATA → valuación
 *
 * Ese último es el caso que obliga: si el permiso razonara por módulo, el veterinario vería los
 * costos por entrar por la puerta de sanidad.
 */

/** Las capacidades de la matriz. Ver `matrix.ts` para quién tiene cada una. */
export type Capability =
  // — el animal y su movimiento —
  | 'hato'
  | 'pesajes'
  | 'movimientos'
  | 'mortandad'
  // — clínico —
  | 'sanidad.indicar'
  | 'sanidad.aplicar'
  | 'laboratorio'
  | 'reproduccion'
  | 'genetica'
  // — operación —
  | 'produccion'
  | 'nutricion'
  | 'campo'
  | 'tareas'
  | 'inventario.existencias'
  | 'maquinaria'
  | 'trazabilidad'
  // — plata —
  | 'inventario.valuacion'
  | 'comercial'
  | 'finanzas'
  | 'impuestos'
  | 'rrhh.parte'
  | 'rrhh.liquidacion'
  | 'rrhh.legajo'
  // — gobierno —
  | 'reportes'
  | 'configuracion'
  | 'usuarios'
  | 'suscripcion'
  // — transversales: las tiene todo el mundo —
  | 'sesion'
  | 'alertas'
  | 'sincronizacion';

export type Access = 'read' | 'write';

export interface RouteRule {
  /** Prefijo de la ruta DECLARADA en el controlador, sin el prefijo global `v1`. */
  prefix: string;
  cap: Capability;
  /**
   * Fuerza el nivel de acceso cuando el verbo miente.
   *
   * En este sistema **varios `GET` escriben** —el motor de alertas es read-through, las
   * notificaciones generan su ledger, la suscripción crea el trial la primera vez— y el propio
   * `AuthInterceptor` ya documenta que por eso el modo espejo no se resuelve por verbo. Acá pasa
   * lo mismo: el verbo es un DEFAULT razonable, no la verdad. Donde no alcanza, se declara.
   */
  access?: Access;
}

/**
 * Ruta → capacidad. **El orden importa: gana la primera que matchea**, así que lo específico va
 * antes que lo general. `assertReglasAlcanzables()` verifica que ninguna quede tapada por otra.
 */
export const ROUTE_RULES: RouteRule[] = [
  // ── Plata escondida en módulos que no son de plata ──────────────────────────
  // Van PRIMERO: si `health` o `inventory` matchearan antes, el veterinario y el capataz verían
  // costos por la puerta de al lado.
  { prefix: 'health/costs', cap: 'inventario.valuacion', access: 'read' },
  { prefix: 'health/consumption', cap: 'inventario.valuacion', access: 'read' },
  // PENDIENTE: dentro de `/inventory` el costo unitario viaja como CAMPO de respuestas que por lo
  // demás son de existencias, así que ahí la valuación no se puede separar por ruta. Es la única
  // capacidad que además necesita esconder una columna, y eso se resuelve en el servicio, no acá.

  // ── Sanidad: indicar ≠ aplicar ──────────────────────────────────────────────
  { prefix: 'health-plans/:id/apply', cap: 'sanidad.aplicar' }, // lanzar la campaña es trabajo de campo
  { prefix: 'health-plans', cap: 'sanidad.indicar' }, // definirla es decisión clínica
  { prefix: 'clinical-cases', cap: 'sanidad.indicar' },
  { prefix: 'products-veterinary', cap: 'sanidad.indicar' },
  { prefix: 'health/admissions', cap: 'sanidad.indicar' },
  { prefix: 'health/reports', cap: 'sanidad.indicar', access: 'read' },
  { prefix: 'health/tasks', cap: 'sanidad.aplicar' },
  { prefix: 'vaccinations', cap: 'sanidad.aplicar' },
  { prefix: 'treatments', cap: 'sanidad.aplicar' },
  { prefix: 'health-events', cap: 'sanidad.aplicar' },
  { prefix: 'mortalities', cap: 'mortandad' },
  { prefix: 'health', cap: 'sanidad.indicar' }, // el resto son vistas: coverage, retiros, kpis
  { prefix: 'lab', cap: 'laboratorio' },

  // ── Reproducción ────────────────────────────────────────────────────────────
  // Las dos únicas rutas de repro que cuelgan de `animals`; van antes que el hato.
  { prefix: 'animals/:id/heats', cap: 'reproduccion' },
  { prefix: 'animals/:id/services', cap: 'reproduccion' },
  { prefix: 'reproduction', cap: 'reproduccion' },
  { prefix: 'synchronization-checks', cap: 'reproduccion' },
  { prefix: 'pregnancy-diagnoses', cap: 'reproduccion' },
  { prefix: 'pregnancies', cap: 'reproduccion' },
  { prefix: 'abortions', cap: 'reproduccion' },
  { prefix: 'calvings', cap: 'reproduccion' },
  { prefix: 'weanings', cap: 'reproduccion' },
  { prefix: 'breeding', cap: 'reproduccion', access: 'read' },
  { prefix: 'genetics', cap: 'genetica' },

  // ── El animal ───────────────────────────────────────────────────────────────
  { prefix: 'weighings', cap: 'pesajes' },
  { prefix: 'movements', cap: 'movimientos' },
  { prefix: 'paddocks', cap: 'movimientos' },
  { prefix: 'animals', cap: 'hato' },
  { prefix: 'lots', cap: 'hato' },
  { prefix: 'imports', cap: 'hato' },

  // ── Operación ───────────────────────────────────────────────────────────────
  { prefix: 'dairy', cap: 'produccion' },
  { prefix: 'feedlot', cap: 'produccion' },
  { prefix: 'slaughter', cap: 'produccion' },
  { prefix: 'nutrition', cap: 'nutricion' },
  { prefix: 'agriculture', cap: 'campo' },
  { prefix: 'grazing', cap: 'campo' },
  { prefix: 'weather', cap: 'campo' },
  { prefix: 'tasks', cap: 'tareas' },
  { prefix: 'inventory', cap: 'inventario.existencias' },
  { prefix: 'machinery', cap: 'maquinaria' },
  { prefix: 'traceability', cap: 'trazabilidad' },
  { prefix: 'documents', cap: 'trazabilidad' },

  // ── Plata ───────────────────────────────────────────────────────────────────
  { prefix: 'commerce', cap: 'comercial' },
  { prefix: 'crm', cap: 'comercial' },
  { prefix: 'finance', cap: 'finanzas' },
  { prefix: 'treasury', cap: 'finanzas' },
  { prefix: 'costs', cap: 'finanzas', access: 'read' },
  { prefix: 'tax', cap: 'impuestos' },
  { prefix: 'hr/work-logs', cap: 'rrhh.parte' },
  { prefix: 'hr/payroll', cap: 'rrhh.liquidacion' },
  { prefix: 'hr/employees', cap: 'rrhh.legajo' },

  // ── Gobierno ────────────────────────────────────────────────────────────────
  { prefix: 'reports', cap: 'reportes', access: 'read' },
  { prefix: 'dashboard', cap: 'reportes', access: 'read' },
  { prefix: 'config', cap: 'configuracion' },
  { prefix: 'onboarding', cap: 'configuracion' },
  { prefix: 'billing', cap: 'suscripcion' },
  // Invitar y sacar gente son la misma capacidad: quien puede dar acceso puede quitarlo. Las
  // rutas públicas del flujo de aceptación (`preview`, `accept`) no pasan por acá —son `@Public`,
  // las protege el token—, así que no necesitan regla.
  { prefix: 'invitations', cap: 'usuarios' },
  { prefix: 'members', cap: 'usuarios' },

  // ── Transversales ───────────────────────────────────────────────────────────
  // `alerts` y `notifications` incluyen GET que ESCRIBEN (evaluación read-through, ledger de
  // notificaciones). Se declaran `read` a propósito: la escritura es la materialización interna
  // de lo que se está leyendo, no una acción del usuario. Reconocer o descartar una alerta sí es
  // una acción, pero no es un privilegio distinto de verla.
  { prefix: 'alerts', cap: 'alertas', access: 'read' },
  { prefix: 'agenda', cap: 'alertas', access: 'read' },
  { prefix: 'notifications', cap: 'alertas', access: 'read' },
  { prefix: 'sync', cap: 'sincronizacion' },
  { prefix: 'auth', cap: 'sesion', access: 'read' },
  { prefix: 'organizations', cap: 'sesion', access: 'read' },
  { prefix: 'farms', cap: 'sesion', access: 'read' },
  { prefix: 'catalogs', cap: 'sesion', access: 'read' },
];

/**
 * Capacidades que la matriz declara pero que TODAVÍA no tienen ninguna ruta.
 *
 * Existen porque la decisión de producto ya se tomó y conviene que esté escrita donde se lee la
 * matriz, no en la cabeza de quien la implemente después. Van en una lista explícita para que el
 * test de coherencia las tolere SIN dejar de detectar una capacidad inventada por error.
 */
export const CAPACIDADES_SIN_RUTA: Capability[] = [
  // Vacía: `usuarios` salió de acá al construirse el módulo de invitaciones. Se deja declarada
  // —y el test la sigue verificando— porque la próxima capacidad que se decida antes de existir
  // va a necesitar el mismo lugar.
];

/**
 * Resuelve la capacidad de una ruta declarada. `null` = ninguna regla la cubre, y eso es un error
 * de configuración, no un permiso denegado: lo levanta el test de cobertura antes de mergear.
 */
export function ruleFor(path: string): RouteRule | null {
  const limpia = path.replace(/^\/+/, '');
  for (const rule of ROUTE_RULES) {
    if (limpia === rule.prefix || limpia.startsWith(rule.prefix + '/')) return rule;
  }
  return null;
}

/** Nivel que exige una request. El verbo es el default; la regla puede corregirlo. */
export function accessFor(method: string, rule: RouteRule): Access {
  return rule.access ?? (method.toUpperCase() === 'GET' ? 'read' : 'write');
}

/**
 * Ninguna regla puede quedar TAPADA por otra anterior más general — si pasa, la capacidad que se
 * declaró nunca se aplica y el permiso silenciosamente es otro. Es exactamente el error que haría
 * que `health/costs` cayera en sanidad. Lo verifica un test.
 */
export function reglasTapadas(): { tapada: string; por: string }[] {
  const out: { tapada: string; por: string }[] = [];
  for (let i = 0; i < ROUTE_RULES.length; i++) {
    for (let j = 0; j < i; j++) {
      const antes = ROUTE_RULES[j].prefix;
      const actual = ROUTE_RULES[i].prefix;
      if (actual === antes || actual.startsWith(antes + '/')) out.push({ tapada: actual, por: antes });
    }
  }
  return out;
}
