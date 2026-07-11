# 0012 — Arquitectura de onboarding y experiencia inicial

- **Estado:** aceptado
- **Fecha:** Fase Producto, sprint P1 (Onboarding SaaS), P1.3
- **Contexto relacionado:** [[0010-tenant-self-service-provisioning]] (registro self-service que P1.3 lleva a la UI), [[0011-email-transactional-credential-lifecycle]] (verificación soft + reset que P1.3 expone en web y móvil), [[0003-offline-first]] (store operativo local del móvil); `docs/product/product-roadmap-2026.md` §P1

## Contexto

Tras P1.1 (registro `POST /register`) y P1.2 (verificación + reset por API), los flujos existían solo
como endpoints HTTP: **no había UI**. El criterio de producto "tiempo-a-primer-registro < 5 minutos"
seguía sin cubrirse — un usuario no podía, desde una pantalla, registrarse, entrar y llegar a una finca
operativa. P1.3 construye esa **experiencia inicial** sobre el diseño visual existente (no es un
rediseño).

Restricciones y hechos del contexto:

- **Web y móvil tienen contextos de uso distintos.** La web es el escritorio de administración (alta de
  finca, lectura de email de verificación, escritura); el móvil es el compañero de campo, **offline-first**
  con un **store operativo local** (`SyncDevice` de `sync-core`) que la UI lee/escribe sin señal.
- La **verificación de email sigue siendo soft** (ADR-0011 C): informa, no bloquea el acceso.
- Durante P1.3 se **descubrió y corrigió una fuga local entre tenants**: al cambiar de usuario en el
  mismo dispositivo, los metadatos de cuenta conmutaban pero el store operativo (y el nombre de finca)
  podían seguir mostrando datos del usuario anterior (P1.3.6a).

## Decisión

Construir la experiencia inicial con una **divergencia deliberada web/móvil**, un **estado de cuenta
separado del estado de sincronización**, y **aislamiento local estricto por tenant**. Decisiones
concretas (todas aprobadas explícitamente antes de implementar):

### A. La web es dueña del ciclo de vida principal de la cuenta
Registro, auto-login, verificación de email, recuperación, reset y **creación del primer animal** viven
en la web. Es el contexto natural para escribir datos de finca, leer el email de verificación y hacer el
setup inicial.

### B. El móvil se orienta a operación de campo
Login, bootstrap, captura offline, **consulta** del estado de cuenta, y recuperación **iniciada** desde el
móvil pero **completada en la web** (el enlace del email abre la web). No hay registro móvil, ni reset
in-app, ni alta móvil del primer animal.

### C. El estado de cuenta vive separado del estado de sincronización
En el móvil, `AccountContext` (identidad del actor + `email_verified`) es una capa aparte de
`SyncContext` (bootstrap/pull/push/store operativo). El estado de cuenta **no** entra al payload de sync,
ni a las tablas ganaderas, ni al store. `AccountContext` **reutiliza** `sync.authFetch` (Bearer + refresh
+ 401→login) — sin un segundo flujo de auth.

### D. `/auth/me` es la fuente de nombre, email, rol y `email_verified`
Ni el nombre del tenant/finca, ni el token JWT (que no se decodifica en cliente), ni constantes locales.
Se eliminó el saludo hardcodeado del móvil. `email_verified` se agregó a `/auth/me` (P1.3.1); en el móvil
se lee en memoria y se re-consulta por sesión/foreground (no se persiste).

### E. Fuente única de países vía DTO público
`country-defaults.ts` sigue siendo la **fuente canónica** de países soportados; se expone como
`GET /catalogs/countries` con un **DTO público explícito `{code, name}`** (no serializa el objeto interno;
no filtra currency/locale/timezone). La web consume el endpoint; no duplica la lista ni usa valores de
respaldo.

### F. El onboarding de finca vacía se decide con `total_animals`, no `active_animals`
`active_animals === 0` **no** implica finca nunca poblada (puede tener animales `dead/sold/culled/lost/
transferred`). El `DashboardService` expone `total_animals` = animales con **`deleted_at IS NULL`,
cualquier estado** — misma política que el listado `GET /animals`. El dashboard ramifica: `total===0` →
onboarding "primer animal"; `total>0 && active===0` → "Sin animales activos" (sin lenguaje de nunca
poblada, sin acciones nuevas); resto → operativo. `active_animals` (el KPI) no se toca.

### G. El store móvil pertenece a `(user_id, tenant_id, farm_id)`
La propiedad del store operativo se registra en la meta persistida. `user_id` + `tenant_id` (del
`/auth/login`) son el mínimo del gate; `farm_id` (del bootstrap) completa el registro. No basta comparar
email ni nombre.

### H. Store único por dispositivo, reiniciado al cambiar de propietario
Se usa **un** store por dispositivo (Alternativa C-1: más simple; no se necesita multicuenta offline
simultáneo aún). Al autenticar, se compara la identidad de la sesión con la dueña del store: mismo dueño
→ se conserva (offline preservado); distinto dueño → se descarta el store, se limpia el `device_id` y se
hace **bootstrap limpio**, con **carga neutral** (nunca se renderiza contenido del dueño anterior).

### I. Cambio de cuenta con operaciones pendientes → se bloquea
Antes de descartar un store incompatible se detectan operaciones locales sin subir (vía
`SyncDevice.pendingCount`, sin hidratar). No se pueden enviar bajo la cuenta nueva (el backend rechaza un
`device_id` de otro tenant — `assertDevice` filtra por `tenant_id` → 404) ni descartar en silencio: el
cambio se **bloquea con aviso** hasta sincronizarlas con su cuenta (o reiniciar la base local).

### J. El `device_id` no se reutiliza entre tenants
Al cambiar de identidad se limpia el `device_id` → se **registra un dispositivo nuevo** bajo el tenant
nuevo. El backend ya lo garantizaba del lado servidor (un `device_id` de otro tenant no resuelve); el
cliente deja de reutilizarlo.

### K. Playwright protege los cinco recorridos críticos, en serie
Cinco escenarios E2E (registro+auto-login, fallback de auto-login, verificación, recuperación+reset,
tenant vacío→primer animal) corren **serialmente** (`workers: 1`) porque comparten una instancia de API,
un archivo de log y una base PGlite. Instancias aisladas levantadas por `global-setup`; el helper de
emails lee el log del adaptador `log` (sin buzón en la app). No es automatización de toda la app.

## Consecuencias

**Ventajas**
- Los primeros cinco minutos quedan cubiertos de punta a punta, verificados por Playwright (5/5).
- La separación cuenta/sync mantiene el móvil offline-first sin acoplar estado de cuenta al store.
- El aislamiento por `(user_id, tenant_id)` cierra una fuga real multi-tenant local.
- Fuente única de países y de la señal de onboarding (`total_animals`) — sin duplicación.

**Costos y limitaciones**
- **Divergencia deliberada web/móvil**: dos experiencias de onboarding que hay que mantener alineadas en
  intención, no en implementación.
- **Dependencia de conectividad** para registro, login y primer bootstrap (offline recién después).
- **No hay creación móvil del primer animal**: una finca nueva solo carga su primer animal desde la web.
- **No hay soporte multicuenta offline simultáneo**: un store por dispositivo.
- **Cambio de cuenta con pendientes requiere intervención del usuario** (sincronizar con la cuenta dueña o
  reiniciar la base local) — no es automático.
- La **suite Playwright añade un navegador (Chromium) e infraestructura de procesos** (build de API, dos
  servidores, log temporal).
- Los **puertos E2E son fijos (3210/3211) y verificados**, no dinámicos: si están ocupados, la suite aborta
  con un mensaje claro en vez de elegir otro puerto.
- Las **nuevas pantallas usan el diseño visual actual**, sin rediseño general (deuda para P1.4).

## Alternativas consideradas

- **Onboarding simétrico web/móvil** (registro y primer animal en ambos): descartado — ignora los
  contextos de uso distintos y obligaría a alta móvil + deep-linking prematuros.
- **Duplicar la lista de países en la UI** o **crear un paquete compartido solo para países**: descartado —
  la web no consume paquetes del workspace hoy y `country-defaults` es config, no dominio puro; el endpoint
  público es el corte limpio (ver ADR-0010/roadmap y la evaluación de dependencias de P1.3.2).
- **Guardar `email_verified` en el payload de sync o en el store ganadero**: descartado — mezcla estado de
  cuenta con estado operativo; se lee de `/auth/me`.
- **Usar `active_animals` como señal de finca nunca poblada**: descartado — un tenant con historial pero
  cero activos vería el onboarding de "primer animal" incorrectamente (P1.3.5a).
- **Borrar silenciosamente las operaciones pendientes al cambiar de cuenta**: descartado — pérdida de datos
  sin aviso.
- **Reutilizar un store o `device_id` entre tenants**: descartado — es exactamente la fuga corregida.
- **Selector multicuenta offline (stores namespaced)** en esta fase: descartado por YAGNI — Alternativa C-2,
  candidata futura.
- **Buzón de email de desarrollo dentro de la app**: descartado — el adaptador `log` + lectura del log de
  test alcanza; no se agrega superficie a la app.

## Fuera de alcance (futuro, no P1.3)

Invitaciones y multiusuario; creación de lotes, potreros y fincas adicionales; registro móvil; reset
in-app y deep-linking; alta móvil del primer animal; rediseño visual general; rate limiting; cookies web
`httpOnly`; stores simultáneos por cuenta; paralelización de Playwright.
