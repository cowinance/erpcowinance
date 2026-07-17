# Mejora integral de Reproducción — cierre por etapas

Convertir Reproducción de un registro de eventos a un **sistema de gestión reproductiva** operativo:
controlar el ciclo celo/servicio → preñez → parto → postparto → nueva preparación → destete → descarte,
integrando Lotes, Sanidad, Tareas, Alertas, Reportes, Animales, Genética y Sync. Estados DERIVADOS de
eventos reales (regla única), sin duplicar lógica.

## Plan por etapas (prioridades del usuario)

1. **Estado reproductivo + días abiertos/postparto + VWP + alertas «próximas a preparar»** ✅
2. Servicios/diagnósticos/partos robustos (idempotencia, dudosa/pérdida, aborto, tareas postparto).
3. Dashboard reproductivo operativo.
4. Protocolos completos (pasos que registran eventos reales).
5. KPIs + reportes ampliados.
6. Integración Lotes / Sanidad / Genética.

---

## Etapa 1 — Estado reproductivo + días abiertos/postparto + alertas ✅

**Punto de partida:** `herdStatus` tenía solo 4 estados (preñada/servida/vacía/idle); NO se calculaban
días abiertos ni postparto; no había VWP configurable ni alertas de «próximas a preparar/abierta/
repetidora/diagnóstico pendiente».

**Dominio (`packages/domain/src/reproduction/repro-status.ts`):** `computeReproStatus(facts, config,
today)` — REGLA PURA que deriva el estado (13 estados: preñada, próxima a parir, servida, diagnóstico
pendiente, en protocolo, abortada, descanso postparto, lista para revisión, lista para servicio,
repetidora, abierta, vacía, descartada) y las métricas (**días postparto / días abiertos / días desde
servicio**, elegible para servicio) desde eventos reales, con `ReproConfig` (VWP, ventana de revisión,
ventana de diagnóstico, umbral de abierta, repetidora, próxima a parir). `DEFAULT_REPRO_CONFIG`.

**Servicio (`repro.service`):**
- `reproConfig()`: lee los umbrales de las reglas de alerta configurables (overrides por tenant) con
  fallback al default del dominio — el VWP es configurable desde la pantalla de Configuración.
- `reproFactsSql()`: ÚNICO lugar que arma los hechos por vientre (preñez abierta, último parto, último
  servicio, último diagnóstico negativo, último aborto, servicios desde el parto, protocolo activo).
- `herdStatus(lotId)`: reescrito para derivar el estado rico + días con la regla única.
- `toPrepare(withinDays)`: vientres en postparto que alcanzarán el VWP dentro de la ventana → **próximas
  a preparar para servicio** (`GET /reproduction/to-prepare`).
- `statusAlerts()`: alertas repro DERIVADAS de la MISMA regla (no re-implementa el estado en SQL):
  diagnóstico pendiente / abierta / repetidora (por vientre) + agregadas «listas para servicio (VWP)» y
  «próximas a preparar».

**Alertas (`alerts.service`):** 5 reglas nuevas configurables (`vwp_ready` 60, `service_prep_due` 7,
`diagnosis_due` 45, `open_too_long` 90, `repeat_breeder` 3). `computeDesired` llama a
`repro.statusAlerts()` y filtra por regla activa (AlertsModule importa ReproModule; sin ciclos). Así las
alertas y el estado comparten una sola fuente de verdad.

**Web (`/reproduccion`):** `HerdStatus` reescrito con los estados ricos (badges), **filtro por estado**
y columnas de días postparto/abiertos; nueva tarjeta `ToPreparePanel` (próximas a preparar, ventana
configurable).

**Tests (11 nuevos):** dominio `repro-status.test` (8: máquina de estados) + `herd-status.integration`
reescrito (4: estados desde eventos, días, repetidora, `toPrepare`, `statusAlerts`). **742 tests** (731
→ +11), 0 ciclos. Verificado en web: herd-status con 12 preñadas / 16 listas / 4 abiertas / 4 próximas a
parir; alerta `open_too_long` (4) derivada en la agenda; página con estados ricos + «próximas a preparar».

### Siguiente
**Etapa 2 — Servicios/diagnósticos/partos robustos:** idempotencia, diagnóstico dudosa/pérdida, aborto
dedicado (causa + edad gestacional), tareas de revisión postparto + preparación al parir, celo→servicio.
