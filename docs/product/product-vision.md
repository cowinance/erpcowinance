# Cowinance — Visión de Producto

**Estado:** vigente (inicio de la Fase Producto). **Basado en:** el estado real del código tras el
Foundation Hardening Sprint (F0-F9), no en las especificaciones `.docx`.

---

## Visión

Cowinance es la **plataforma integral de administración bovina** para el productor
latinoamericano: un cuaderno de campo digital que funciona **sin señal**, con trazabilidad
individual, cumplimiento sanitario garantizado por el servidor, e indicadores productivos — de
punta a punta, del corral a la oficina.

## Problema que resolvemos

El productor bovino profesional hoy administra su operación con **papel, Excel o sistemas
fragmentados**. Esto genera:
- **Pérdida de trazabilidad individual** (no hay historia por animal).
- **Riesgo sanitario y legal** (vender carne/leche dentro del período de retiro de un tratamiento).
- **Cero visibilidad de KPIs** (ganancia diaria, tasa de preñez, producción).
- Todo **agravado por la mala conectividad** en el campo: los sistemas online-only no sirven en la
  manga.

## Usuario objetivo

**Productor bovino profesional latinoamericano**, con finca de **tamaño mediano** (≈200-1500
animales), operación de **carne, leche o mixta**, que necesita trazabilidad individual y trabaja
frecuentemente con **conectividad limitada**. Ver [personas.md](personas.md).

> **Decisión estratégica (aprobada):** el primer piloto se orienta a **finca bovina mixta
> (leche + carne)**. Una finca mixta ejercita en un solo entorno identificación individual,
> genealogía, sanidad, reproducción, potreros, pesajes, crecimiento y producción — y expone las
> necesidades específicas de ordeño. Si resolvemos bien una finca mixta, tenemos base sólida para
> especializarnos después hacia carne y lechería. **Esto NO significa construir el módulo lechero
> ahora:** el piloto valida el núcleo ganadero existente y *descubre* qué capacidades adicionales
> aportan más valor.

## Propuesta de valor

*El cuaderno de campo digital que funciona sin señal.* Capturás en la manga; sincroniza cuando hay
red; el **servidor garantiza la integridad** (no registrás inconsistencias, no vendés en período de
retiro por error). Trazabilidad individual + KPIs + cumplimiento, en carne, leche o mixto.

## Diferenciadores (construidos y verificados, no promesas)

1. **Offline-first real y verificado** — convergencia determinista probada (2000/2000 escenarios).
   La competencia suele ser online-only o con offline pobre.
2. **Server Authority sobre valores de inocuidad** — los retiros sanitarios se calculan y fuerzan en
   el servidor (ADR-0007); el cumplimiento no depende de que el dispositivo del operario esté bien.
3. **SaaS multi-tenant** con aislamiento por RLS — vs. software instalado de escritorio.
4. **Móvil como primer ciudadano** — la captura en manga es el diseño central, no un add-on.
5. **Plataforma integral bovina** — carne, leche y mixto en un solo modelo, no productos separados.

## Estado del producto: construido vs. futuro

**Construido y funcionando** (API + web + móvil): hato, sanidad, reproducción, potreros/mapa,
pesajes/producción, dashboard/reportes, alertas, fotos, sync offline, identidad multi-tenant.
Ver el detalle en `docs/sprints/foundation-hardening-executive-summary.md` §1.

**Falta para MVP comercial** (no existe hoy — no asumir): onboarding/auto-registro de tenant,
importación de datos, facturación, config de catálogos por UI, documentos con vencimiento, email
transaccional, RBAC real.

**Fuera de alcance ahora** (Fase 2+): módulo lechero completo, agricultura, feedlot, inventarios,
finanzas/contabilidad, IoT/drones, IA, blockchain, marketplace, multiempresa, hardware (báscula
BT/RFID/voz).

## Nota honesta de localización

El código actual tiene defaults **argentinos** (`es-AR`, categorías vaca/novillo/vaquillona, razas
Angus/Hereford/Brangus/Nelore). La visión es **LatAm**; la localización real por país (terminología,
categorías, normativa sanitaria) es trabajo futuro conocido, **no construido**. El piloto mixto
ayudará a descubrir qué localización importa primero.

## Principio permanente

El próximo salto de Cowinance es **de producto, no de arquitectura**. La base técnica ya está
endurecida (F0-F9). La arquitectura evolucionará de forma **incremental y dirigida por necesidad
real** descubierta con fincas reales — no con más sprints de hardening. La disciplina del sprint
anterior (no sobreingeniería, abstracción solo con consumidor real, decisiones en ADR, deuda
registrada, separar implementado de futuro) se mantiene como forma de trabajo.
