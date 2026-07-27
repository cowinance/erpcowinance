# ADR-0017 — Plano de plataforma: administración global sin romper el aislamiento por tenant

- **Estado:** aceptada
- **Fecha:** 2026-07-26
- **Contexto:** Fase 1 del panel de dueño de Cowinance (`/v1/platform/*` + web `/admin`)

## Contexto

Cowinance necesita un panel para administrar la PLATAFORMA —cuentas, usuarios, suscripciones, uso,
estado de correos— separado del ERP que usa cada finca. Dos cosas del diseño actual lo impedían:

1. **El login resuelve un tenant obligatorio.** `AuthService.login` busca la primera fila de
   `user_role_assignments` y lanza `auth.no_tenant` si no hay ninguna. Un dueño de Cowinance no
   pertenece a ninguna finca: no puede entrar. Y darle una asignación cualquiera le entregaría un
   token de tenant sobre datos de un cliente.

2. **La RLS es FORCE en ~150 tablas.** Cada request corre dentro de una transacción con
   `SET LOCAL app.tenant_id`, y sin ese GUC las policies no devuelven filas (fail-closed). Un panel
   global necesita leer a través de los tenants; ninguno de los dos caminos existentes lo permite.

Los roles `owner` y `admin` NO sirven: son RBAC dentro de una organización
(`user_role_assignments.tenant_id` es `NOT NULL`). Reutilizarlos haría que agregar un rol de
plataforma fuera indistinguible de agregar un rol de finca.

## Alternativas consideradas

| Opción | Por qué se descartó |
|---|---|
| Claim `platform_admin` en el access token del ERP | Ese token vive en el navegador de la finca, viaja en cada request, se renueva cada 15 min y aparece en logs de proxies. Filtrarlo pasaría a valer para el panel global. |
| Aflojar `tenant_isolation` (agregar un `OR` de bypass) | Toca la policy de la que depende TODO el aislamiento. Un error ahí filtra todo, en todas las tablas, para siempre. |
| Rol de base con `BYPASSRLS` | Funciona, pero el bypass es total e indiscriminado: el panel podría leer y ESCRIBIR cualquier tabla de cualquier tenant. Además suma carga operativa (crear y rotar un rol en RDS). |
| Iterar tenant por tenant fijando `app.tenant_id` | O(n) round-trips y, peor, el panel operaría con contexto de tenant real — el estado exacto que queremos que no exista. |

## Decisión

### 1. Sesión propia, separada por la CLAVE y no por un `if`

`POST /v1/platform/auth/login` emite un JWT con `typ: 'platform'`, **sin claim `ten`**, firmado con
`HMAC-SHA256(JWT_SECRET, 'cowinance-platform')`.

- La clave se **deriva**: es determinística (nada nuevo que configurar ni rotar por separado) y
  distinta por construcción. Un access token del ERP no verifica contra ella y viceversa. Rotar
  `JWT_SECRET` invalida las dos cosas a la vez, que es lo que uno espera al rotar.
- El `AuthInterceptor` ya exigía `typ === 'access'`, así que la separación quedó bidireccional sin
  tocarlo.
- Sin claim `ten` porque no hay organización que representar: eso es lo que resuelve el problema del
  administrador sin finca sin inventarle una.
- **Sin refresh token.** La sesión dura 30 minutos y se vuelve a entrar. Evita duplicar la máquina
  de rotación y detección de reuso, que es la parte más delicada de `auth`.

Las credenciales SÍ se comparten (una persona, una contraseña, un solo lugar donde rehashear y
revocar). Lo que no se comparte es la sesión.

### 2. Segunda policy permisiva `FOR SELECT`, sobre una lista corta

`platformMigration()` (en `apps/api/src/db/rls.ts`) agrega a cada tabla de `PLATFORM_READ_TABLES`
una policy `platform_read`:

```sql
CREATE POLICY platform_read ON "<tabla>" FOR SELECT
  USING (current_setting('app.platform_read', true) = 'on');
```

Tres propiedades que la hacen la opción más segura de las evaluadas:

- **`tenant_isolation` queda intacta.** Las policies permisivas se OR-ean: una sesión de tenant
  sigue viendo lo suyo y nada más. Agregar el panel no aflojó el ERP.
- **`FOR SELECT` hace que la fase 1 sea de solo lectura POR CONSTRUCCIÓN.** `INSERT`/`UPDATE`/
  `DELETE` siguen pasando solo por `tenant_isolation`, que exige un `app.tenant_id` que el plano de
  plataforma nunca fija. Aunque alguien agregara el endpoint, la base lo deniega.
- **El allowlist es corto y explícito** (8 tablas: `companies`, `farms`, `animals`,
  `subscriptions`, `subscription_usage`, `billing_payments`, `files`, `sync_devices`). Los
  contenidos de la finca —sanidad, ventas, sueldos, pesadas— no son visibles para el panel. Es la
  diferencia entre administrar cuentas y espiar clientes.

El GUC es fail-closed en los dos estados residuales posibles con un pool: `NULL` antes de cualquier
`SET`, `''` después de una transacción que lo fijó. Comparar contra un literal descarta ambos sin
castear (a diferencia de `app.tenant_id`, que necesitó el `NULLIF` de la migración 0021).

### 3. Puerta con verificación viva

`PlatformAdminGuard` verifica el token Y **consulta `platform_admins` en cada request**. Un
round-trip por request es un precio ridículo comparado con poder cortar el acceso al instante en vez
de esperar a que venza la sesión.

`@PlatformController()` compone `@Controller` + `@Public()` + guard + interceptor de auditoría en un
solo decorador: `@Public()` sin guard sería una ruta abierta, y al no poder escribir una sin la otra
ese error deja de ser posible.

### 4. Bitácora global propia

`audit_logs` tiene `tenant_id NOT NULL` y policy por tenant: una acción global no tiene tenant al
cual pertenecer, y si se le inventara uno la bitácora quedaría visible desde el ERP de esa finca.
`platform_audit_logs` no tiene `tenant_id` (sí `target_tenant_id`, nullable, que es el OBJETO de la
acción) y su policy exige el GUC de plataforma: invisible desde el ERP.

Se auditan las LECTURAS, no solo las escrituras. En un panel de solo lectura, «quién miró qué» es
exactamente el evento que importa.

## Consecuencias

- Agregar una tabla al alcance del panel es editar `PLATFORM_READ_TABLES`: una decisión visible en
  el diff, no un descuido.
- La fase 2 (suspender cuentas, cambiar planes, impersonar) va a necesitar, además del endpoint, una
  decisión explícita sobre la policy —hoy `FOR SELECT`— y probablemente policies de escritura
  separadas por acción. Eso es deliberado: que escribir cueste una decisión de esquema.
- El primer administrador se promueve desde `PLATFORM_SUPERADMIN_EMAIL` sobre un usuario que YA
  existe. No se crean credenciales por variable de entorno, y la promoción es idempotente: no
  reactiva a alguien deshabilitado a propósito.
- MFA queda modelado (`platform_admins.mfa_required` + `users.mfa_enabled`) y con interruptor
  (`PLATFORM_MFA_ENFORCED`), apagado hasta que exista el flujo TOTP. Prenderlo hoy dejaría a todos
  afuera; el día que exista es una variable, no una migración.

## Verificación

- `apps/api/src/modules/platform/platform.integration.test.ts` — 23 pruebas: frontera de acceso en
  las dos direcciones, revocación inmediata, higiene de campos sensibles, forma de las policies, y
  que el GUC no sobrevive a su transacción.
- `npm run verify:rls` — sección «Plano de plataforma»: sobre PostgreSQL real y con un rol
  NOSUPERUSER/NOBYPASSRLS, comprueba que el panel lee cross-tenant, que NO puede escribir, que las
  tablas fuera del allowlist siguen cerradas, y que `platform_admins` es invisible desde el ERP.
  **Ésta es la verificación que importa**: en PGlite (superusuario) ninguna policy se ejerce.
