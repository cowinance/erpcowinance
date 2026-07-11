# 0010 — Provisioning self-service de tenant (registro SaaS)

- **Estado:** aceptado (decisión; implementación en P1.1 de la Fase Producto)
- **Fecha:** Fase Producto, sprint P1 (Onboarding SaaS)
- **Contexto relacionado:** [[0001-modular-monolith]], [[0003-offline-first]], [[0005-event-bus-outbox]] (patrón hexagonal puerto/adaptador); `docs/product/product-roadmap-2026.md` §P1

## Contexto

Tras el Foundation Hardening Sprint, Cowinance funciona pero **la única vía de crear una
organización, finca y usuario es `seed.ts`** (datos demo). Ninguna finca real puede registrarse sola
— es un demo, no un SaaS. Para conseguir design partners (ver `docs/product/design-partner-strategy.md`)
hace falta que un usuario nuevo se registre y empiece a usar la plataforma **sin intervención manual**.

Hechos verificados del plano de identidad actual:
- **`tenant_id = organization.id`**; la RLS aísla por `app.tenant_id` (= org).
- `users` es global (email UNIQUE, sin RLS); `organizations` y `user_role_assignments` **no** son
  RLS; `companies` y `farms` **sí** son RLS.
- El login toma la **primera** `user_role_assignment` del usuario para resolver tenant+rol.
- Los **roles del sistema** (`owner`, …) son globales (`tenant_id NULL`, `is_system`).
- `seed.ts` crea **dos cosas mezcladas**: (1) catálogos globales (roles, países, monedas, unidades,
  especies, razas, categorías) que **todo tenant necesita**, y (2) datos demo (org/finca/hato).
- El registro correría **@Public** (sin `AuthInterceptor`), por lo tanto **sin contexto de tenant**.

## Decisión

Introducir **registro self-service** que provisiona un tenant nuevo de forma atómica, reutilizando el
plano de identidad existente. Cinco decisiones concretas:

### 1. Se expande el módulo `identity` (no se crea un módulo `account`)
`identity` ya es el bounded context de identidad (hoy expone `organizations/current` y `farms`).
Agregarle el write-side (provisioning) lo deja cohesivo: `identity` = usuarios + organizaciones +
fincas + asignaciones + provisioning inicial. **`auth` mantiene solo autenticación y sesiones** — no
se mezcla el registro con auth. Crear un módulo `account` al lado fragmentaría la identidad en dos.

### 2. Creación atómica en una sola transacción
El endpoint `POST /register` crea, **todo o nada**, en una transacción:
`user` → `organization` → `company` → `farm` → `user_role_assignment` (rol `owner`). Si algo falla,
rollback total: nunca queda media cuenta.

### 3. Manejo del contexto RLS en un flujo público
El registro corre sin `AuthInterceptor`, así que **no** hay `requestContext.q` ni GUC de tenant. El
servicio abre su **propia** transacción (`db.tx`) y hace **todos** los inserts por ese handle `q`
(no por `this.db.query`, que fuera de request iría a la conexión cruda, sin tx ni GUC). `users` y
`organizations` se insertan sin GUC (no son RLS); tras crear la org, se ejecuta
`SET LOCAL app.tenant_id = <orgId>` (con `is_local=true`, igual que el `AuthInterceptor`) para
habilitar los inserts de `companies` y `farms` (RLS) dentro de la misma tx.

### 4. Separación bootstrap de catálogos ↔ seed demo
Se extrae `bootstrapCatalogs()` (los catálogos globales: roles, países, monedas, unidades, especies,
razas, categorías) de `seedDemo()` (org/finca/hato demo), con cambio **mínimo** — se conserva la
lógica existente. `bootstrapCatalogs` corre **siempre** que falten (idempotente); `seedDemo` corre
**solo** en dev / con flag (`SEED_DEMO`, default on en dev, off en producción). Así una instalación
limpia (`SEED_DEMO=off`) tiene los catálogos que el registro necesita, **sin** datos demo.

### 5. Estado `email_verified_at` preparado (verificación real en P1.2)
Se agrega `users.email_verified_at` (default NULL = no verificado). En **P1.1 no bloquea** el acceso
(decisión de producto: reducir fricción para design partners — registro → acceso permitido →
verificación pendiente). El estado existe desde el día uno para que P1.2 conecte el envío/verificación
y para que acciones sensibles futuras puedan exigir verificación sin cambio de esquema.

## Alternativas consideradas

- **Módulo `account` separado.** Descartada: `identity` ya es el bounded context de identidad;
  `account` al lado lo fragmentaría. Se logra la separación que importa (identidad ≠ auth) sin partir
  la identidad.
- **Auto-login (register devuelve tokens).** Descartada para P1.1: obligaría a `identity` a usar la
  emisión de sesión de `auth`, invirtiendo la dependencia. `register → 201` y luego `/auth/login`
  mantiene identity (provisiona) y auth (autentica) desacoplados. El acceso inmediato se preserva
  (login funciona al instante).
- **Creación posterior de tenant (lazy, en el primer login).** Descartada: mezcla autenticación con
  provisioning y complica el flujo de login (que hoy asume que la asignación ya existe); el registro
  explícito es más claro y testeable.
- **Provisioning por IdP externo (Keycloak/Auth0).** Descartada por ahora: el emisor de tokens actual
  ya tiene shape OIDC y se reemplazará por un IdP en producción (ADR/arquitectura), pero delegar el
  provisioning de org/finca en un IdP externo es sobredimensionado para el piloto; el provisioning es
  de dominio de Cowinance (org+company+farm), no de identidad genérica.

## Consecuencias positivas

- **Cowinance pasa de demo a SaaS real:** una finca se registra y empieza sola, sin `seed.ts`.
- **Reutiliza el plano existente:** users/organizations/companies/farms/roles/assignments + RLS +
  emisión de tokens — sin capa nueva.
- **Instalación limpia funciona como producción:** catálogos garantizados, cero datos demo.
- **Aislamiento multi-tenant intacto:** la RLS sigue aislando; se verifica con un test de aislamiento
  como gate.
- **Preparado para P1.2** (verificación) sin cambios de esquema posteriores.

## Consecuencias negativas

- **Flujo público que gestiona RLS a mano:** el registro debe fijar el GUC dentro de su tx; un error
  ahí bloquea inserts (RLS → cero filas) o, peor, filtra. Riesgo real, mitigado por diseño (todo por
  el `q` de la tx) y por el test de aislamiento obligatorio.
- **Superficie pública nueva:** `register` expuesto sin auth → requiere, más adelante, rate limiting
  y política anti-enumeración de emails (P1.2/futuro, **no** P1.1); en P1.1 solo validación básica y
  409 en email duplicado.
- **Deuda de migraciones se hace más visible:** P1.1 agrega una columna vía `ALTER … IF NOT EXISTS`
  idempotente (alcanza para dev); una herramienta de migración real es necesidad futura, no P1.
- **`bootstrapCatalogs` debe ser idempotente** para correr en cada arranque sin duplicar — pequeño
  costo de guardas (`ON CONFLICT`/check de existencia).

## Fuera de alcance (futuro, no P1.1)

Envío real de email y verificación (P1.2), reset de contraseña (P1.2), invitación de usuarios a una
org existente (tabla `invitations` ya en el schema), multi-organización por usuario (login ya toma la
primera asignación; el resto es futuro), rate limiting / anti-enumeración, RBAC real, herramienta de
migración formal.
