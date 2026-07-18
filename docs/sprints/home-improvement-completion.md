# Inicio / Home → centro de control diario (COMPLETO 5/5)

De un panel de KPIs a la **pantalla real de trabajo**: en <10 s el usuario ve qué pasa, qué
requiere atención hoy, qué está vencido, qué riesgos hay y puede actuar rápido — desde web y móvil.
Compone los servicios existentes (dashboard/tasks/alerts/health/repro) SIN duplicar reglas.

## Etapas

### E1 — Endpoint agregado `/dashboard/home` (`24f8d80`)
`DashboardHomeService.home()` compone en PARALELO dashboard.kpis + tasks.kpis + alerts.kpis +
alerts.agenda + health.kpis + repro.kpis + tasks.board + conteo sin-pesaje + recentActivity.
Devuelve `kpis` integrados, `priority` (atención ordenada por severidad, con href), `farm_status`,
`agenda` combinada (health/repro + tareas), `recent_activity`, `by_category`, `weight_series`,
`counts`. **Clave de perf: las señales repro-derivadas (listas/diagnóstico/parto) se cuentan desde
alerts.agenda —que ya corre computeReproStatus una vez— sin recomputar herdStatus.** HealthModule
exporta HealthService; DashboardModule importa Tasks/Alerts/Health/Repro (sin ciclos).
`/dashboard/kpis` legacy INTACTO.

### E2 — Web: atención prioritaria + estado general + KPIs (`ceee326`)
Rediseño de page.tsx: bloque «Atención prioritaria» arriba (tarjetas con conteo + borde por
severidad, cada una navega a su vista) + fila «Estado general» (Operación/Sanidad/Reproducción/
Tareas) + 8 KPIs integrados + agenda combinada. Ítems de tarea con related_type='task'+
action='complete_task' → AgendaAttention muestra el botón «✓».

### E3 — Web: acciones rápidas + actividad enriquecida (`8434732`)
Barra de acciones rápidas (Manga/Crear/Tarea/Tratamiento/Vacuna/Servicio/Parto/Mover/Tareas-
vencidas → rutas y anchors reales). Actividad reciente enriquecida (recentActivity backend:
responsable + lote; web ícono+color por tipo de evento).

### E4 — Móvil: home operativo de campo (`0f79823`)
Rediseño index.tsx sin exceso de gráficos, «qué hacer ahora» primero: atención prioritaria
compacta (online best-effort vía authFetch, se oculta offline) + AgendaToday (local/offline) +
botón GRANDE Manga + accesos grandes Tareas/Sincronizar + estado compacto. Offline-first.

### E5 — Roles + estados vacíos + navegación (`a663b94`)
Personalización por rol (estructura preparada): home devuelve `role` (getter DbService.role); el
web reordena el énfasis por rol sin ocultar datos (veterinario→sanidad, capataz/operario→campo;
owner/admin→base) + badge «Vista: <rol>». Estados vacíos: banner «Todo al día», «Sin actividad
reciente» (+ onboarding/sin-activos/API-caída ya existentes).

## Criterios técnicos cumplidos
- No duplica reglas: cada número viene de su servicio dueño.
- No rompe endpoints (/dashboard/kpis legacy intacto), multi-tenant, offline móvil.
- Performance: composición en paralelo, consultas acotadas, sin recomputar herdStatus.
- Tests del endpoint agregado (composición, prioridad, agenda) + estados vacíos cubiertos por
  las ramas condicionales.

## Estado
- **Dashboard 3 tests** (composición multi-módulo + prioridad ordenada + agenda por urgencia).
  tsc API + móvil limpios. Verificado e2e web (E2/E3/E5 owner); móvil por tsc (runtime RN/Expo v57).

## Diferido / follow-up
- **Rol no-owner**: la personalización es estructura preparada; el seed solo asigna owner, así que
  el reordenamiento por veterinario/capataz no se verificó e2e (la lógica es simple y type-safe).
- **«Asignadas a mí» en móvil**: TaskRow local no proyecta assigned_to (se usó pendientes locales).
- **Perf fincas MUY grandes**: alerts.agenda (herdStatus sobre todos los vientres) es el techo;
  un read-model/caché lo mejoraría (futuro CQRS-lite, ver decisión de alcance de DashboardService).
- **Cache .next**: durante dev puede corromperse (chunks faltantes → app sin estilos); fix
  `rm -rf apps/web/.next` + restart. No es bug del código.
