# Facturación SaaS (B-1 + B-2) · Cierre de sprint

**Estado:** ✅ COMPLETO (estado + límites) · ⏳ Pago real diferido (B-3, lado proveedor) · **Rama:** `main`
**Alcance:** activar la facturación SaaS a nivel de **estado y entitlements** — catálogo de planes,
suscripción por tenant con uso vs límites, y **enforcement de límites** — **sin procesar pagos**.

> Registro histórico del sprint. Cierres previos: [`p9-reportes-completion.md`](./p9-reportes-completion.md),
> [`r2-reproduccion-gestion-completion.md`](./r2-reproduccion-gestion-completion.md).

---

## 1. Objetivo y límite

Las tablas `plans`, `subscriptions`, `invoices`, `payments` existían pero estaban **dormidas** (sin
módulo ni UI). Este vertical activa la parte **no-pago**: qué plan tiene un tenant, su período/estado,
su uso vs los límites del plan, y el **bloqueo al exceder** un límite.

**Límite duro (no negociable):** no se procesan pagos, ni se ingresan tarjetas/credenciales, ni se
ejecutan cobros. El pago real (cobro, webhooks del proveedor, invoices/payments) es **B-3**, del lado
del operador/proveedor de pagos — fuera de alcance de este sprint.

## 2. Alcance implementado

- **B-1 — Planes + suscripción (estado):** seed de planes; módulo `billing` con catálogo, suscripción
  del tenant (read-through de trial), uso vs límites, y cambio administrativo de plan (owner/admin,
  sin cobro); web `/suscripcion`.
- **B-2 — Enforcement de límites:** `assertWithinLimit` bloquea la creación de animales/dispositivos
  al alcanzar el límite del plan.

## 3. Arquitectura

```
   plans (catálogo global, seed)        subscriptions (por tenant, RLS)
              └──────────────┬───────────────┘
                     BillingService (billing)
        getSubscription (read-through trial) · listPlans · changePlan (owner/admin)
                     assertWithinLimit(resource) ← regla única de entitlements
                              │
        HerdService.createAnimal ─┤        SyncService.registerDevice ─┤   (import queda FUERA: D3)
                              │
                     Web /suscripcion (plan · estado · uso vs límites · cambiar plan)
```

Invariantes:
- **Read-through de trial:** `GET /billing/subscription` crea un trial de 30 días si falta → todo
  tenant (nuevo o existente) tiene suscripción, sin hook en el registro.
- **Regla única de entitlements:** `assertWithinLimit` es el único lugar que decide "¿puede el tenant
  crear uno más?"; los create-paths la invocan.
- **Acoplamiento acíclico:** `herd→billing`, `sync→billing`; `billing` no importa herd/sync (0 ciclos).
- **Sin pago:** el cambio de plan no cobra; el UI lo dice explícitamente.

## 4. Decisiones importantes

- **Fix RLS de `subscriptions`:** tenía una policy dispersa sobre `app.current_tenant` (que la app
  nunca setea → denegaría en prod) y no estaba en `RLS_TABLES`. Se agregó (policy estándar
  `app.tenant_id`) + drop de la dispersa. Mismo patrón que `repro_protocols` (R-2.a). Guardia `.mjs`
  no-super.
- **Enforcement solo en create-paths REST:** el importador (P2) llama `persistNewAnimal` directo →
  queda fuera del límite a propósito (su enforcement es follow-up).
- **`max_users` sin guardar:** no hay endpoint de invitación de usuarios (solo el owner) → sin
  create-path que limitar hoy.
- **`null` = sin límite;** bloqueo duro con 403 `plan.limit_reached` y mensaje accionable.

## 5. Criterios de aceptación cumplidos

- Todo tenant tiene una suscripción (trial por defecto) y ve su plan, período, estado y uso vs límites.
- Un owner/admin puede cambiar de plan (sin cobro); otros roles reciben 403.
- Crear un animal/dispositivo por encima del límite del plan devuelve 403 con mensaje claro; por
  debajo o sin límite, procede.
- Aislamiento por tenant de `subscriptions` verificado bajo rol no-super.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **407 tests** (billing estado, gating por rol, enforcement de límites) |
| Ciclos de dependencia (madge) | **0** (`herd→billing`/`sync→billing` acíclicos) |
| Guardia RLS `.mjs` (no-super) | `subscriptions` 4/4 |
| Playwright E2E (web) | `19-suscripcion` (trial, uso vs límites, cambio de plan) · suite completa 22/22 sin regresión |

## 7. Decisiones diferidas y trabajo futuro

- **B-3 — Pago real (lado proveedor/operador):** integración con proveedor de pagos, webhooks que
  actualizan `subscription.status`/`invoices`/`payments` por `external_ref`. El cobro y las
  credenciales son del operador; fuera de alcance del asistente.
- **Enforcement de import masivo:** hoy el importador puede pasar el límite; pre-chequeo de capacidad
  al iniciar el import como follow-up.
- **Gating por estado** (`suspended`/`past_due`/`canceled` → restringir escrituras o banner).
- **Invitación de usuarios + límite `max_users`** cuando exista el flujo de miembros.
- **Facturación real** (`invoices`/`payments`), comprobantes, impuestos.

## 8. Estado del roadmap

**Facturación SaaS (estado + límites) → COMPLETO.** El catálogo de planes, la suscripción por tenant,
el uso vs límites y el enforcement están terminados, verificados y estables en `main`, con la parte de
**cobro real explícitamente diferida** al operador/proveedor.

**Siguiente fase: próximo vertical, por definir.** Mismo método: análisis previo aprobado antes de
código, olas pequeñas y revisables, verificación completa y un commit por ola.
