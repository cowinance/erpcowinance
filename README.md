# Cowinance

Plataforma ERP para ganadería, agricultura y administración de fincas. La especificación completa vive en [docs/](docs/) (14 documentos: arquitectura, roadmap, catálogo de 40 módulos, design system, APIs, modelo de datos y módulos funcionales).

## Estado

**Fase 0-1 del roadmap** (alcance funcional de Fase 1 completo en web):
- **Hato**: dashboard, lista maestra, ficha 360° con línea de tiempo y genealogía (madre/padre/crías), captura de pesajes, lookup por caravana.
- **Sanidad**: vacunaciones, tratamientos con cálculo automático de retiros (carne/leche) según el producto, diagnósticos, mortalidad con baja del animal; KPIs (cobertura, retiros activos, mortalidad).
- **Reproducción**: ciclo completo celo → servicio (IA/monta) → diagnóstico (crea la preñez con fecha probable de parto desde el servicio + 283 d) → parto (alta de crías con genealogía) → destete; KPIs y próximos partos.
- **Modo manga** (`/manga`): captura masiva de campo en alto contraste AAA — caravana → peso → condición corporal, con feedback auditivo y contador de progreso.
- **Potreros y Mapa** (`/mapa`): mapa 2D esquemático con polígonos coloreados por ocupación/carga, panel contextual por potrero y movimiento de lotes entre potreros (registrado en la línea de tiempo de cada animal).
- **Reportes** (`/reportes`): inventario del hato **a fecha reconstruido por el ciclo de vida** de cada animal (el número cambia según la fecha, prueba del event-sourcing), altas/bajas del período, producción (GDP por lote) y reproducción; todos exportables a CSV.
- **Motor de sincronización offline v0**: changesets con relojes híbridos (HLC), LWW por campo, conflictos semánticos y duplicados con cola de revisión, dedupe exactly-once por (device, seq), panel de flota.

## Estructura del monorepo

```
apps/api            api-core — monolito modular NestJS (identity, herd, health, repro, dashboard, sync)
apps/web            Aplicación web Next.js con el design system "Cowinance UI"
apps/mobile         App móvil offline-first (Expo / React Native + expo-router)
packages/db         Modelo de datos canónico: DDL PostgreSQL de 140 tablas
packages/sync-core  Motor de sync: HLC, changesets, merge determinista + suite de simulación
docs/               Especificación completa (14 documentos .docx)
```

## App móvil (esqueleto)

Offline-first real: la UI lee y escribe **solo contra el store local** (`@cowinance/sync-core` como cliente).
Persistencia incremental por mutación (hooks `DeviceMutation` del motor): **SQLite** en iOS/Android
(`storage.native.ts`) y AsyncStorage en web como harness de verificación. Primer arranque: registra el
dispositivo y se hidrata con `GET /sync/bootstrap`; después funciona sin señal.

Sincronización **automática**: al arrancar, ~2,5 s después de cada captura (debounce), cada 60 s en
primer plano, y al recuperar señal (drena la cola sin intervención). El botón manual sigue disponible.

```bash
cd apps/mobile && npm install
npm run web        # verificación en navegador (react-native-web, puerto 8081)
npm run ios        # o android — mismo código en nativo
```

Incluye: tab bar de 5 posiciones con botón central que abre el **capturador rápido** (doc diseño §3.2),
lista de animales local con búsqueda, ficha con estado reproductivo y actividad del dispositivo,
**modo manga nativo** (pesaje + condición corporal) y captura offline de **sanidad y reproducción**:
vacunar, tratar (retiros calculados en el dispositivo), celo, servicio, diagnóstico de preñez
(fecha probable desde el último servicio local + 283 d) y parto con alta de la cría y genealogía.
El protocolo de sync cubre `weighings`, `vaccinations`, `treatments`, `breeding_events`, `calvings`,
`calving_offspring`, `animal_events` (hechos) y puts LWW sobre `animals` y `pregnancies`; el bootstrap
baja el catálogo veterinario y las preñeces abiertas.

La pantalla **Sincronización** del móvil muestra la cola pendiente con detalle legible (visible offline)
y los conflictos del servidor en revisión con resolución de un toque; el resultado del sync avisa si un
push generó conflictos.

## Motor de sincronización

La suite de simulación de convergencia (criterio de salida de Fase 0: >99%) corre con:

```bash
npm run sim -w @cowinance/sync-core          # 2.000 escenarios aleatorios (semilla determinista)
node apps/api/scripts/sync-e2e.mjs           # E2E por HTTP contra la API (requiere npm run api)
```

Resultado actual: **2.000/2.000 escenarios convergen (100%)**, con transporte no confiable (acks perdidos → reenvío, cursores no persistidos → re-aplicación idempotente), relojes desviados ±5 min, estados terminales concurrentes y caravanas duplicadas.

Endpoints (doc de APIs §7): `POST /v1/sync/devices`, `POST /v1/sync/push`, `GET /v1/sync/pull?device_id=&cursor=`, `GET /v1/sync/state`, `GET /v1/sync/conflicts`, `POST /v1/sync/resolve`. Panel de flota en la web: `/sincronizacion`.

## Correr en local

Requisitos: Node ≥ 22. No hace falta instalar PostgreSQL: en desarrollo la API usa **PGlite** (Postgres embebido) y carga el DDL canónico completo + datos demo en el primer arranque.

```bash
npm install
npm run api    # api-core en http://localhost:3001/v1
npm run web    # web en http://localhost:3000
```

En producción el mismo DDL corre sobre PostgreSQL 17 + PostGIS + TimescaleDB (los tipos `geography` se degradan a `jsonb` solo en dev).

`npm install` compila automáticamente los paquetes internos (`domain`, `sync-core`, `design-tokens`)
vía su script `prepare`: su `dist/` está gitignoreado, así que sin ese paso un clone fresco no
resolvería `@cowinance/domain` y compañía.

### Limpiar artefactos

```bash
npm run clean:web   # borra apps/web/.next
npm run clean       # además: dist de la API y de los paquetes
npm run rebuild     # clean + build de todo
```

Si la web aparece **sin estilos** o el server tira `Cannot find module './NNN.js'` / `/_app`, es el
cache de Next dev corrompido: `npm run clean:web` y reiniciar. No es un error del código.

## Despliegue con Docker

Stack completo (PostgreSQL 17 + PostGIS · api-core · web) con las mismas imágenes que irían a un
servidor:

```bash
cp .env.example .env
```

Completar en `.env` como mínimo `JWT_SECRET`, `POSTGRES_PASSWORD` y `APP_DB_PASSWORD`; después:

```bash
docker compose -f docker-compose.prod.yml up --build
```

Verificar que quedó arriba:

```bash
curl http://localhost:3001/v1/healthz && curl http://localhost:3001/v1/readyz
```

Tres decisiones que no son de forma:

- **Dos roles de base, no uno.** La API **sirve** con `cowinance_app` (`NOSUPERUSER NOBYPASSRLS`,
  creado por [`deploy/postgres-init`](deploy/postgres-init/)) y **migra** con el rol
  administrativo. Con un superusuario, PostgreSQL le saltea la RLS y el aislamiento por tenant
  queda reducido a que ninguna query se olvide nunca del `WHERE tenant_id`.
- **El esquema se aplica solo, y una vez.** Al arrancar, la API carga el DDL canónico si la base
  está vacía y después aplica las migraciones pendientes de
  [`packages/db/migrations/`](packages/db/migrations/), registrándolas en `schema_migrations`.
- **`NEXT_PUBLIC_API_URL` se hornea en la imagen de la web.** Next la inlinea en el bundle del
  navegador durante el build: es un `--build-arg`, no una variable de runtime. Una imagen por
  entorno.

Para un despliegue de verdad hay que configurar además dos adaptadores; con los defaults de
desarrollo el arranque avisa exactamente qué queda roto:

| Variable | Default | Qué pasa si se deja así en producción |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Las fotos y documentos van al disco del contenedor: se pierden en el próximo deploy y no los ve otra instancia. Con `s3` (AWS, Cloudflare R2, MinIO, Backblaze B2) viven fuera del proceso. |
| `EMAIL_PROVIDER` | `log` | El correo se **imprime**: la verificación de email y el reset de contraseña no le llegan al usuario. Con `smtp` se envía de verdad, contra cualquier proveedor. |

Lo que este compose **no** resuelve (ver [la auditoría](docs/audits/auditoria-2026-07-24.md)):
una sola instancia de API — el rate limit cuenta en memoria.

### Migraciones de esquema

```
packages/db/cowinance_schema.sql   → versión 0000 (DDL canónico, solo si la base está vacía)
packages/db/migrations/NNNN_*.sql  → se aplican una vez, en orden, cada una en su transacción
```

Una migración **ya aplicada es historia**: si cambia en disco, el arranque aborta con el detalle.
Corregir siempre con una migración nueva, nunca editando la vieja — si no, esta base y una base
nueva describen esquemas distintos sin que nada avise.

Las **políticas de RLS no son migraciones**: se generan desde `RLS_TABLES` y se re-aplican en cada
arranque, para que agregar una tabla a esa lista siga creando su política sola.

## Verificar el aislamiento por tenant (RLS) sobre PostgreSQL real

En dev la app corre sobre PGlite, que conecta como **superusuario** — y un superusuario **saltea
RLS aunque la política exista**. Es decir: en desarrollo las policies se crean pero nunca se
ejercen, así que una fuga cross-tenant recién aparecería en producción. Para cerrar ese hueco:

```bash
docker compose up -d db   # PostgreSQL 17 + PostGIS 3.5 (el stack de producción)
npm run verify:rls        # carga el DDL, aplica las políticas y ejerce el aislamiento
docker compose down -v    # al terminar
```

El script se conecta con un rol **no privilegiado** (`NOSUPERUSER NOBYPASSRLS`, como debe conectar
la app en prod) y comprueba que: cada tenant ve solo lo suyo, sin `app.tenant_id` no ve **nada**
(fail-closed), y no puede escribir, modificar ni borrar filas de otro tenant. Aplica las políticas
desde `apps/api/src/db/rls.ts` —la **misma fuente** que usa el arranque de la app—, así que verifica
lo que realmente corre, no una copia.

> Complementa al guardarraíl `rls-coverage.guardrail.integration.test.ts` de la suite, que exige
> que toda tabla con `tenant_id` tenga política o esté exenta a propósito: ese cubre la
> **cobertura**; este, que el aislamiento **efectivamente aísla**.

### Correr la app entera contra PostgreSQL

`verify:rls` prueba el **motor** (las políticas aíslan si `app.tenant_id` está bien puesto). Falta
la otra mitad: que la app **fije** esa variable en cada request —trabajo del interceptor de auth—.
Si eso se rompiera, `verify:rls` seguiría verde y la fuga existiría igual. Para cubrirlo:

```bash
docker compose up -d db
npm run verify:pg    # levanta la API real y ejerce la frontera por HTTP con dos tenants
```

Arranca el binario de producción con un rol **restringido** (`NOSUPERUSER NOBYPASSRLS`) y comprueba
que cada tenant ve solo lo suyo y que uno **no puede leer ni modificar** un recurso del otro aunque
conozca su id (404), incluido un endpoint que compone varios módulos.

La app elige driver por entorno, sin cambiar código de negocio:

| Variable | Efecto |
|---|---|
| *(ninguna)* | **PGlite** embebido — dev, sin instalar nada |
| `DATABASE_URL` | **PostgreSQL real**; usar el rol de servicio (mínimos privilegios) |
| `DATABASE_ADMIN_URL` | opcional: conexión con privilegios solo para el DDL de arranque |

Separar ambas conexiones replica producción: **migrar con credenciales elevadas, servir con las
mínimas**. Es lo que hace que la RLS se ejerza de verdad — con un superusuario se saltearía.

## Configuración por variables de entorno

| Variable | Ámbito | Propósito | Default / ausencia |
|---|---|---|---|
| `SEED_DEMO` | API | Sembrar datos demo al arrancar | `on` en dev, `off` en producción (`NODE_ENV=production`); override `true`/`false` |
| `EMAIL_PROVIDER` | API | Adaptador de email (puerto `EmailSender`, ADR-0011) | `log` (imprime el email al log) — **solo desarrollo**. `smtp` envía de verdad (SES, Postmark, Mailgun, Resend, Gmail o relay propio): pide `SMTP_HOST` y `SMTP_FROM` |
| `STORAGE_DRIVER` | API | Adaptador de archivos (puerto `FileStorage`) | `local` (disco del proceso, `.data/uploads`) — **solo desarrollo**. `s3` para cualquier almacén compatible (AWS, R2, MinIO, B2): pide `S3_ENDPOINT`, `S3_BUCKET` y las credenciales |
| `APP_BASE_URL` | API | Base del front para armar los **enlaces de email** (verificación/reset) | `http://localhost:3000` — apuntar a la web real en despliegue |
| `NEXT_PUBLIC_API_URL` | Web | URL de la API que consume la web (se **inlinea en build** para componentes cliente) | `http://localhost:3001/v1` |
| `EXPO_PUBLIC_WEB_URL` | Móvil | Base pública de la web para el botón "Abrir Cowinance web" del estado vacío del hato (ADR-0012) | **sin default**: si falta, la UI muestra instrucciones en texto **sin** hardcodear dominios y **sin** botón |
| `JWT_SECRET` | API | Clave HMAC de los JWT (access, refresh, tokens de archivo) | dev: clave pública de desarrollo. **Producción: obligatoria** — el proceso NO arranca sin ella, ni con la de desarrollo, ni con menos de 32 caracteres (`openssl rand -base64 48`) |
| `CORS_ORIGINS` | API | Orígenes permitidos, separados por comas | dev: refleja el origen. Producción sin lista: **CORS deshabilitado** (móvil y render server-side siguen funcionando: no son navegadores con origen) |
| `TRUST_PROXY` | API | ¿Hay balanceador delante? `true` (1 salto) o cantidad de saltos | `false`. Necesario para que el rate limit vea la IP real; sin proxy, confiar dejaría que el cliente elija su IP |
| `FORCE_HTTPS` | API | Enviar `Strict-Transport-Security` | `false`. Activarlo sobre HTTP plano deja el host inaccesible en los navegadores que ya lo vieron |

Plantilla completa con comentarios: [`.env.example`](.env.example).

> Ningún token de acción se documenta ni se registra: viajan solo en el email y se guardan hasheados (ADR-0011).

### Sondas de plataforma

| Endpoint | Qué responde | Para qué |
|---|---|---|
| `GET /v1/healthz` | `{status, uptime_s}` | *Liveness*. **No** toca la base a propósito: si un incidente de base marcara "muerto" al proceso, el orquestador lo reiniciaría en loop y empeoraría el incidente |
| `GET /v1/readyz` | `{status:"ready"}` o **503** | *Readiness*. Verifica la base. Falla → sale de la rotación del balanceador sin reiniciarse |

### Límite de intentos

Los endpoints públicos de credenciales (`/auth/login`, `/auth/refresh`, `register`, `verify-email`,
`resend-verification`, `forgot-password`, `reset-password`) están limitados **por IP y por email a la
vez** — la segunda dimensión frena el *password spraying*, que el límite por IP no ve. Credenciales:
10 intentos / 5 min; endpoints que envían email: 5 / 15 min. El contador vive en el proceso: con
varias instancias hay que moverlo a un almacén compartido (ver `docs/audits/auditoria-2026-07-24.md`, H-2).

### Tokens de diseño (fuente única — ADR-0013)

`packages/design-tokens/src/tokens.ts` es la **única fuente editable** de tokens (color/radio/sombra/fuente,
**escala tipográfica por roles**, **escala de spacing** y **contrato de densidad** — P1.4.3/ADR-0014).
Los artefactos por plataforma se **derivan**, no se editan a mano:

- **Web:** `apps/web/src/app/tokens.generated.css` (generado; `globals.css` lo importa). **No editar el `.css`.**
- **Móvil:** `apps/mobile/src/theme.ts` es un adaptador que reexporta `T` desde la fuente.

**Escala tipográfica (roles semánticos, P1.4.3).** Nada de `text-[Npx]`/`fontSize: N` mágicos: se usan **roles por función**
(`text-<rol>` en web vía `@theme`; `T.type.<rol>` en móvil, números). Roles estables: `display, title, heading,
subheading, input, body, label, caption, hero`. **Solo tamaño** — line-height, peso, tracking y color siguen siendo
ejes separados. `typeCompat` (`text-compat-<n>` / `T.compat['<n>']`) son **aliases temporales de compatibilidad
(deuda)** para valores no canónicos; no usar en código nuevo.

**Escala de spacing (móvil, P1.4.3).** `T.space['<k>']` (grid 4px + sub-unidad 2px, claves estilo Tailwind:
`['2']`=8, `['2.5']`=10, `['4']`=16…), solo para layout (padding/margin/gap), no dimensiones/alturas. La **web ya
consume la escala de Tailwind**, así que `space` no se emite a web.

**Excepciones documentadas** (behavior-preserving; deuda de convergencia futura): `text-xl` y `fontSize` de SVG (web);
manga como superficie **bespoke** (web y móvil); identificadores mono de caravana, contenido de 14px, inputs de 15px y
logo (móvil); base raíz `<body>`; `7`/`14` px de spacing móvil. Ver la nota de implementación de
[ADR-0014](docs/adr/0014-design-system-specification.md).

```bash
npm run tokens:build   # edita tokens.ts → regenera el CSS de la web (explícito)
npm run tokens:check   # falla si el artefacto derivó de la fuente (gate; no autocorrige)
```

`tokens:check` es Gate 0 de `audit:arch`.

### Especificación del Design System (ADR-0014)

Sobre la fuente de tokens, la **especificación completa** del sistema visual vive en
[`docs/design-system/P1.4.2-design-system-spec.md`](docs/design-system/P1.4.2-design-system-spec.md)
(contrato del frontend: escala tipográfica por roles, spacing, densidad ERP, dark mode, iconografía,
inventario de componentes, motion, accesibilidad AA y responsive). Las decisiones de arquitectura que
de ella se derivan están en [ADR-0014](docs/adr/0014-design-system-specification.md). **P1.4.3 (aplicación de
la escala tipográfica y de spacing, web + móvil) está cerrado** — behavior-preserving, ver la nota de
implementación del ADR y el handoff. **P1.4.4 (primitivos + densidad) está CERRADO:** el mecanismo de densidad
runtime y el eje de tamaño están en [ADR-0015](docs/adr/0015-density-runtime-primitive-size-axis.md); los
primitivos web (**Button**, **Input/Select/Field**, tamaños `lg`/`md`/`sm`) están **aplicados en toda la web**
(auth, alta de animal, Sanidad, Reproducción, Reportes, HealthPlans, FarmMap, WeighingForm…), behavior-preserving;
`inputCls`/`labelCls` compartidos eliminados y 4 aliases `typeCompat` sin uso podados. Estado, decisiones y deuda
diferida (icon-only, danger, secondary sobre `bg-sunken`, búsqueda con icono, CTA-Link) en
[`docs/design-system/P1.4.4-closure.md`](docs/design-system/P1.4.4-closure.md) y
[`primitives.md`](docs/design-system/primitives.md). Con esto, **P1.4 (Fundamentos de experiencia) está completo**;
los primitivos y la densidad son web (móvil fuera de alcance de P1.4.4).

## E2E web — recorrido de onboarding (Playwright)

Suite Playwright que protege los cinco flujos de onboarding (registro+auto-login, fallback de auto-login,
verificación, recuperación+reset, tenant vacío→primer animal). Detalle completo en
[`apps/web/e2e/README.md`](apps/web/e2e/README.md).

```bash
# Una sola vez: navegador (en CI Linux, --with-deps)
npx playwright install chromium

# Correr la suite (compila la API + levanta instancias aisladas + corre 5 escenarios)
npm run e2e:web
```

- **Instancias aisladas**: `apps/web/e2e/global-setup.ts` levanta una API (`SEED_DEMO=off`,
  `EMAIL_PROVIDER=log`) y `next dev` en **puertos de test 3210/3211** (verificados libres; no mata procesos
  ajenos). No depende de servidores iniciados a mano.
- **DB y log temporales** viven en `os.tmpdir()/cowinance-web-e2e/` (**fuera del repo**) y se **borran** en el
  teardown, aun si un test falla. El helper de emails lee ese log (no hay buzón en la app).
- **Ejecución serial** (`workers: 1`): los cinco escenarios comparten una API, un log y una base PGlite.
- Comando de CI (deuda inmediata; el repo no tiene workflow todavía): `npx playwright install --with-deps
  chromium && npm run e2e:web`. `audit:arch` **no** arranca Playwright — el gate E2E es explícito y separado.

## API (extracto)

Sigue las convenciones del documento de APIs: prefijo `/v1`, paginación por cursor, errores con código de dominio, `Idempotency-Key` en POST.

- `GET /v1/dashboard/kpis` — vitales del dashboard
- `GET /v1/animals?status=&category=&lot=&q=&cursor=` — lista maestra
- `GET /v1/animals/:id` — ficha 360°
- `GET /v1/animals/:id/timeline` — línea de tiempo de eventos
- `POST /v1/animals` — alta de animal
- `POST /v1/animals/:id/events` — evento polimórfico (`weighing`, `note`, …)
- `GET /v1/lots` · `GET /v1/farms` · `GET /v1/organizations/current`

**Importación / migración de datos (P2, en curso).** Capacidad transversal de migración; primer
caso: animales. `POST /v1/imports` (multipart CSV) · `GET /v1/imports/:id` · `GET /v1/imports/:id/rows`
(paginado) · `PUT /v1/imports/:id/mapping` · `POST /v1/imports/:id/preview`. El vertical **subir →
mapear → previsualizar** está completo; el commit/procesador y la genealogía son la fase siguiente.
Detalle en [docs/import.md](docs/import.md). Las entidades creadas server-side (altas web e import)
se propagan por pull a dispositivos vía **changesets de origen servidor** ([ADR-0016](docs/adr/0016-server-origin-changesets.md)).

## Identidad y multi-tenant

- **Login con JWT** (access 15 min + refresh 7 días con **rotación y detección de reuso**): el emisor dev
  vive en la API con el mismo shape de claims que un IdP OIDC (en producción se reemplaza por
  Keycloak/Auth0 cambiando solo la clave de verificación del interceptor).
- **RLS activa y forzada** en 24 tablas de dominio: cada request corre en una transacción con
  `SET LOCAL app.tenant_id`; sin contexto, cero filas. Verificado con dos tenants
  (`cowinance@gmail.com / cowinance` — Grupo La Esperanza; `maria@elombu.com / ombu1234` — El Ombú):
  cada uno ve solo su hato y el acceso cruzado por id devuelve 404.
- E2E: `node apps/api/scripts/auth-e2e.mjs` (15 checks).

## Limitaciones conocidas (entorno dev)

- **Emisor de tokens embebido**: sin MFA/passkeys ni SSO SAML; llegan al integrar el IdP externo.
- **RBAC superficial**: el rol viaja en el token pero no restringe endpoints todavía (ABAC/Cedar pendiente).
- **`Idempotency-Key` en REST**: se acepta la cabecera pero el dedupe solo está implementado en el canal
  de sincronización (device + seq); en REST es un no-op por ahora.
- **Fechas en UTC**: los cálculos de retiro/parto usan fechas ISO UTC; la presentación por zona horaria
  del establecimiento queda pendiente.
- **Suscripciones parciales**: el bootstrap baja el tenant completo; el filtrado por fincas asignadas al
  dispositivo queda pendiente.

## Próximos pasos (según roadmap)

1. Sanidad y Reproducción completos (Fase 1)
2. Autenticación OIDC + RLS multi-tenant real
3. App móvil offline-first (React Native + Expo) con modo manga, usando `@cowinance/sync-core` como cliente
4. Protocolo binario (Protobuf + zstd) para el canal de sync en redes 2G/3G
