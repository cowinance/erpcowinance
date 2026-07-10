# Cowinance — Roadmap de Producto 2026

**Estado:** vigente (inicio Fase Producto). Priorizado por **valor de negocio**, no por facilidad
técnica. Sprints chicos, con el mismo proceso del Foundation Hardening: análisis → diseño →
aprobación → implementación incremental → validación.

**Objetivo de la fase:** convertir la base técnica (F0-F9) en un ERP ganadero SaaS que una finca
real pueda **adoptar sola**, validado con **design partners** antes de cobrar.

> Separación explícita: **Comprometido cercano** (P1-P3) = el camino a fincas piloto usándolo.
> **Posterior** (P4-P6) = una vez validada la adopción. **Fuera de alcance** = Fase 2+ (módulos
> nuevos), no en este roadmap.

---

## Comprometido cercano — camino a design partners

### P1 — Onboarding SaaS (el gate #1)
- **Objetivo:** que una finca nueva cree cuenta → organización → finca → primeros animales, y use el
  sistema **sin intervención nuestra**.
- **Valor usuario:** deja de ser un demo; se vuelve un producto que se empieza solo.
- **Alcance:** registro (crea org + finca + usuario owner + tenant), verificación de email, reset de
  contraseña, y el flujo web/móvil de "primeros 5 minutos" (crear finca → primer animal).
- **Dependencias:** email transaccional (infra nueva mínima, patrón puerto/adaptador como el Event
  Bus).
- **Riesgos técnicos:** el plano de identidad hoy asume tenants sembrados (`seed.ts`); el
  auto-registro toca auth/identity (feature, no hardening). Email es infra nueva.
- **Impacto arquitectónico:** bajo-medio. Reusa auth/RLS; agrega adaptador de email.
- **Criterio de aceptación:** un email nuevo → cuenta creada → login → finca con 1 animal, sin tocar
  `seed.ts` ni la base a mano.

### P2 — Migración de datos (importación transversal)
- **Objetivo:** que una finca cargue su hato existente sin tipear cientos/miles de animales.
- **Valor usuario:** migrar la operación real, no un demo.
- **Alcance:** importador diseñado como **capacidad transversal de migración empresarial**, no un
  "importador Excel" puntual. Primer caso: **animales** (caravana, categoría, sexo, raza, fecha,
  genealogía). Diseñado para extenderse a **movimientos, inventarios futuros y datos históricos**.
  Validación por VOs, reporte de errores por fila, dedupe de caravanas.
- **Dependencias:** P1 (necesita un tenant real).
- **Riesgos técnicos:** mapeo de columnas heterogéneas entre fincas, dedupe, tamaño de lote/tx,
  calidad de los datos de origen.
- **Impacto arquitectónico:** bajo-medio. Reusa VOs + servicios de dominio para validar; posible
  emisión de eventos (`AnimalRegistered`, patrón F5). La abstracción de "fuente → mapeo → validación
  → carga" se diseña para reuso, **sin sobreingeniería** — se generaliza cuando el segundo caso
  (movimientos) lo demuestre.
- **Criterio de aceptación:** una planilla de 500 filas importa; filas inválidas se reportan sin
  abortar; caravanas duplicadas se detectan; la genealogía básica se vincula.

### P3 — Productización del loop diario + móvil
- **Objetivo:** que un capataz adopte el uso diario **sin capacitación**.
- **Valor usuario:** retención — se usa todos los días en la manga.
- **Alcance:** estados vacíos, guía in-app, pulido de captura/manga, onboarding dentro de la app
  móvil, manejo de errores amigable.
- **Dependencias:** P1.
- **Riesgos técnicos:** bajos (UX sobre lo existente).
- **Impacto arquitectónico:** nulo.
- **Criterio de aceptación:** un usuario nuevo completa "registrar un tratamiento en la manga" sin
  ayuda externa.

> **Hito de negocio tras P1-P3:** 3-5 fincas piloto usando Cowinance (gratis). Medir adopción antes
> de seguir. Ver [design-partner-strategy.md](design-partner-strategy.md).

---

## Posterior — una vez validada la adopción

### P4 — Config/customizing de catálogos
- **Objetivo:** que cada finca ajuste razas, categorías, diagnósticos, productos.
- **Valor:** el producto se adapta a la realidad de cada finca (clave para LatAm y para mixto).
- **Alcance:** UI CRUD de catálogos por tenant (ya son tablas con `tenant_id`).
- **Dependencias:** P1. **Impacto arquitectónico:** bajo.
- **Criterio:** una finca agrega una raza local y la usa en el alta.

### P5 — Documentos formales con vencimiento
- **Objetivo:** guías, vacunación oficial, certificados, con alerta de vencimiento.
- **Valor:** cumplimiento; no perder vencimientos.
- **Alcance:** entidad documento + vencimiento + integración con el **motor de alertas existente**.
- **Dependencias:** motor de alertas (ya existe). **Impacto arquitectónico:** bajo.
- **Criterio:** un documento próximo a vencer genera alerta.

### P6 — Facturación SaaS (solo con adopción comprobada)
- **Objetivo:** cobrar.
- **Valor negocio:** ingresos.
- **Alcance:** planes, medición de uso, integración con pasarela regional. Modelo **a definir** desde
  los design partners (ver [monetization-strategy.md](monetization-strategy.md)).
- **Dependencias:** P1-P3 + design partners validados + pasarela de pago (infra externa).
- **Riesgos:** construir billing antes de tener usuarios es prematuro; el cobro real depende de
  pasarela regional. RBAC real empieza a importar con multi-usuario.
- **Impacto arquitectónico:** medio.
- **Criterio:** un tenant en plan pago con límite de uso aplicado.

---

## Fuera de alcance de este roadmap (Fase 2+)

Módulo lechero completo, agricultura, feedlot, inventarios, finanzas/contabilidad, IoT/drones, IA,
blockchain, marketplace, multiempresa, hardware. Se retoman **según lo que descubran los design
partners**, no por la lista de specs. La localización LatAm por país también entra acá como
descubrimiento del piloto.
