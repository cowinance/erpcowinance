# Auditoría completa — Cowinance ERP · 24 de julio de 2026

Auditoría de salud, seguridad, preparación para producción y completitud funcional.
Todo lo que sigue está **verificado ejecutando**, no inferido: cada afirmación tiene el comando
que la produjo. Los hallazgos llevan estado (`CORREGIDO` / `PENDIENTE`) y, los pendientes,
el paso del plan que los cierra.

---

## 1. Salud del código: verde

| Gate | Resultado |
|---|---|
| Suite completa (`npm test`) | **914 tests / 154 archivos, todos verdes**, 85 s |
| Typecheck (domain, sync-core, design-tokens, api, móvil) | limpio |
| Typecheck web (`tsc -p apps/web`) | limpio |
| Build de producción (`npm run build`) | OK — 61 páginas de Next + 3 paquetes |
| Ciclos de dependencia (madge) | **0** |
| Tokens de diseño sin deriva | OK |
| Cobertura domain + sync-core | 83.91 % (baseline 72.54 → **+11.4**) |
| Duplicación (jscpd) | 5.45 % / 221 clones (baseline 4.17 → **+1.28**) |
| `TODO`/`FIXME`/`HACK` reales | **0** (los 88 matches son la palabra española «todos») |
| Secretos commiteados | ninguno |
| Inyección SQL | ninguna: todo parametrizado; las 2 interpolaciones (`costing.laborSql`) vienen de enums validados contra lista blanca — verificado en `costsByCenter`, `profitability` y `budgetVsActual` |
| Autenticación | interceptor **global** (`APP_INTERCEPTOR`), 55 controladores cubiertos; lo público es explícito con `@Public()` |

**La base es sólida.** Los hallazgos de abajo no son deuda del dominio: son la capa que separa
«un ERP que funciona en la máquina del desarrollador» de «un producto desplegado».

---

## 2. Hallazgos

### 2.1 Seguridad

#### H-1 · CRÍTICO — `JWT_SECRET` con fallback público · **CORREGIDO**

`auth.service.ts` hacía `process.env.JWT_SECRET ?? 'cowinance-dev-secret'`. Desplegar sin definir
la variable —el olvido más común de un primer deploy— dejaba la API firmando con una clave que
**está en el repositorio**. Con ella se emite un access token con el `ten` (tenant) y el `role`
que uno quiera: acceso total a los datos de cualquier finca, sin tocar la base ni la contraseña
de nadie. **La RLS no protege de esto**: el token *es* la identidad que la RLS respeta.

*Corrección:* `apps/api/src/modules/auth/jwt-secret.ts` — en `NODE_ENV=production` el proceso no
arranca si falta la clave, si es la de desarrollo, o si tiene menos de 32 caracteres. En
desarrollo el fallback se conserva (`npm run api` sigue arrancando sin configurar nada).
7 tests.

#### H-2 · ALTO — Sin límite de intentos en los endpoints de credenciales · **CORREGIDO**

`POST /v1/auth/login`, `/refresh`, `/register`, `/forgot-password`, `/reset-password` aceptaban
intentos ilimitados. Un diccionario contra una cuenta conocida solo estaba acotado por el costo
de scrypt (~24 ms), o sea unos 40 intentos por segundo por conexión.

*Corrección:* `common/rate-limit.ts` (ventana deslizante pura, 6 tests) + `rate-limit.guard.ts`
registrado como `APP_GUARD` y activo solo donde hay `@RateLimit`. Limita en **dos dimensiones a
la vez**: por IP (diccionario clásico) y por email (*password spraying*: una contraseña común
contra muchas cuentas desde muchas IPs, que el límite por IP no ve). Credenciales: 10 intentos /
5 min. Endpoints que mandan email: 5 / 15 min. Un intento rechazado **no** extiende el bloqueo,
para que martillar no deje afuera al usuario legítimo detrás de la misma IP.

*Límite conocido:* el contador vive en el proceso. Con varias instancias, el límite efectivo se
multiplica por la cantidad de instancias — correcto para el despliegue de una instancia y base
honesta para mover el almacén a Redis después (la regla no cambia). **Requiere `TRUST_PROXY`**
detrás de un balanceador, o todas las requests comparten la IP del proxy.

#### H-3 · MEDIO — Derivación de contraseñas por debajo del mínimo recomendado · **CORREGIDO**

`hashPassword` usaba `scryptSync` con los defaults de Node (N=2¹⁴ = 16 MiB), por debajo de lo que
recomienda OWASP para scrypt. Además era **síncrona**: bloqueaba el event loop en cada login.

*Corrección:* esquema `s3` (N=2¹⁶ = 64 MiB, ~90 ms) y derivación asíncrona en el threadpool. El
esquema viaja en el hash, así que **las contraseñas ya guardadas siguen entrando** (`s2` se
verifica) y se re-hashean solas en el próximo login (`needsRehash` — el único momento en que la
contraseña en claro está disponible). Se agregó guarda de longitud antes de `timingSafeEqual`,
que **lanzaba** con un hash truncado: eso daba 500 en vez de «credenciales inválidas». 7 tests.

#### H-4 · MEDIO — CORS reflejaba cualquier origen · **CORREGIDO**

`app.enableCors({ origin: true })` habilitaba a cualquier sitio web a llamar a la API desde el
navegador del usuario.

*Corrección:* `common/http-hardening.ts` — lista explícita por `CORS_ORIGINS`; en producción, sin
lista, **no se habilita CORS** (el móvil y el render server-side de Next no son navegadores con
origen: siguen funcionando). En desarrollo se sigue reflejando, para no pelear con puertos. 4 tests.

#### H-5 · MEDIO — Sin cabeceras de seguridad · **CORREGIDO**

*Corrección:* middleware propio (sin dependencia nueva): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy`,
`X-Permitted-Cross-Domain-Policies`, se quita `X-Powered-By`, y HSTS **solo** con `FORCE_HTTPS=true`
(activarlo sobre HTTP plano deja el host inaccesible en los navegadores que ya lo vieron). 3 tests.

#### H-6 · MEDIO — Tokens en cookies legibles por JavaScript · **PENDIENTE** → paso 2.3

`apps/web/src/lib/auth.ts` escribe `cw_access` y `cw_refresh` con `document.cookie`: son
`SameSite=Lax` pero **no `HttpOnly`** (no pueden serlo: las escribe el cliente). Cualquier XSS en
la web se lleva la sesión, y el refresh dura 7 días. El arreglo correcto es que el login pase por
un *route handler* de Next que fije las cookies del lado del servidor con `HttpOnly`; es un
refactor del borde de autenticación de la web, no un parche.

#### H-7 · INFORMATIVO — 3 avisos altos de npm sin versión corregida disponible

`next`, y `postcss`/`sharp` como dependencias suyas. **No hay release parcheada**: el rango
vulnerable declarado es `9.3.4-canary.0 – 16.3.0-preview.7`, o sea *todas* las versiones
publicadas, incluida la 16 estable; el único «fix» que ofrece npm es bajar a `next@9.3.3`, que no
es una opción. Se aplicó `npm audit fix` (Next 15.3 → **15.5.21**, dentro del rango semver).

*Exposición real, verificada:* baja. El aviso de mayor impacto (DoS por SVG en la API de
optimización de imágenes) **no aplica**: la web no usa `next/image` en ningún lado. Tampoco hay
servidor custom (SSRF en Server Actions) ni `rewrites` con destino controlable. Acción: seguir
`next@16.3.0` y actualizar cuando salga.

### 2.2 Preparación para producción

Esta es la brecha real, y explica por qué el producto todavía no es «final»: el sistema está
completo por dentro y **no tiene con qué salir**.

#### H-8 · ALTO — No hay artefactos de despliegue · **CORREGIDO** (paso 1.1)

No existía `Dockerfile` (ni para la API ni para la web), ni compose de producción, ni
`.env.example`. El CI verificaba, pero nada publicaba.

*Corrección:* `apps/api/Dockerfile` y `apps/web/Dockerfile` (multi-etapa, usuario no-root,
healthcheck) + `docker-compose.prod.yml` + `.dockerignore` + `deploy/postgres-init/`.
**Verificado levantando el stack entero**: PostgreSQL 17+PostGIS → esquema canónico → 8
migraciones → seed → login → dashboard con datos reales → la web sirviendo y redirigiendo.

Tres cosas que el trabajo destapó y que no eran obvias:

1. **npm corre el `prepare` de los workspaces locales aunque se le pase `--ignore-scripts`.** El
   `prepare` de `domain`/`sync-core`/`design-tokens` compila su `dist/` con `tsc`. En el stage de
   build eso obliga a copiar las fuentes ANTES de instalar; en el de runtime, donde `tsc` no
   existe, hay que sacarle el hook al `package.json` (el `dist/` ya viene del stage anterior).
2. **`COPY` preserva los permisos del host**, y `cowinance_schema.sql` estaba en `0600`: el
   contenedor corre como `node`, no como root, y el arranque moría con `EACCES` al leer el DDL.
   Se normaliza con `chmod -R a+rX` en la imagen, no dependiendo de cada máquina.
3. **El compose usa DOS roles de base.** La API sirve con `cowinance_app`
   (`NOSUPERUSER NOBYPASSRLS`) y migra con el administrativo. Con el superusuario —que es lo que
   sale por defecto— PostgreSQL le saltea la RLS y el aislamiento por tenant se reduce al
   `WHERE tenant_id` de cada query. **Verificado con los dos tenants del seed: 57 y 5 animales,
   cada uno viendo solo lo suyo, con `rolsuper=false rolbypassrls=false`.**

*También corregido acá:* la API ya no arranca en producción sin `DATABASE_URL` — PGlite sobre el
disco efímero de un contenedor perdería los datos en el próximo deploy. Mismo criterio que
`JWT_SECRET`; ambos guardas verificados corriendo la imagen real.

#### H-9 · ALTO — Sin sondas de plataforma · **CORREGIDO**

Ningún endpoint de liveness/readiness: el balanceador mandaba tráfico a una instancia que todavía
estaba cargando el esquema (140 tablas), y un proceso colgado no se reiniciaba nunca.

*Corrección:* `modules/ops` — `GET /v1/healthz` (liveness; **no** toca la base a propósito: si un
incidente de base marcara «muerto» al proceso, el orquestador lo reiniciaría en loop y empeoraría
el incidente) y `GET /v1/readyz` (readiness; verifica la base, 503 si no responde).

#### H-10 · ALTO — No hay migraciones versionadas · **CORREGIDO** (paso 1.2)

El esquema se cargaba entero solo si la base estaba vacía; de ahí en adelante la evolución vivía
en 7 constantes de DDL idempotente dentro de `db.service.ts`, que corrían **completas en cada
arranque**. Funcionaba, pero no había versión aplicada, ni orden garantizado, ni forma de saber
en qué estado estaba una base de producción — y sobre todo, nada impedía **editar una migración
ya aplicada**, que es el error más caro: el cambio entra en las bases nuevas y no en las viejas,
y las dos divergen en silencio.

*Corrección:* `packages/db/migrations/0001…0008.sql` + `apps/api/src/db/migrations.ts`
(tabla `schema_migrations` con versión y checksum, aplicación solo de lo pendiente, cada
migración en su propia transacción, y **aborto del arranque si cambió el checksum de una ya
aplicada**). `db.service.ts` pasó de **588 a 229 líneas**. 14 tests nuevos, incluidos dos que
verifican propiedades de las migraciones reales: que sigan siendo idempotentes (`IF NOT EXISTS`,
`DROP … IF EXISTS` antes de crear) y que ninguna use `CREATE INDEX CONCURRENTLY`, que Postgres
prohíbe dentro de una transacción.

**La ruta de actualización está verificada, no supuesta:** una base que ya existía (sin
`schema_migrations`) ve las 8 como pendientes, las re-aplica sin efecto —por idempotentes—, las
registra, y el segundo arranque no aplica ninguna. Probado sobre la base de desarrollo real
(57 animales, dashboard y login intactos después) y sobre PostgreSQL en contenedor.

Lo que **no** se versionó, a propósito: las **políticas de RLS**. Son convergentes — se generan
desde `RLS_TABLES` y tienen que re-aplicarse cuando esa lista cambia, que es justo lo que hace
útil al guardarraíl (agregar una tabla crea su política sola). Versionarlas rompería esa
propiedad, así que `rlsMigration()` sigue corriendo en cada arranque.

#### H-11 · ALTO — Los archivos se guardan en el disco local · **CORREGIDO** (paso 1.3)

`media.service.ts` y `documents.service.ts` escribían con `writeFileSync` contra el filesystem del
proceso —**duplicando además el mismo camino de escritura**—. Con más de una instancia, la foto que
subía una no la servía la otra; con un contenedor efímero, se perdían en el próximo deploy.

*Corrección:* puerto `FILE_STORAGE` (`application/ports/file-storage.port.ts`) con dos adaptadores
en `infra/storage/`: `LocalFileStorage` (desarrollo; **mismo layout `.data/uploads/<tenant>/<file>`
de antes**, así que una instalación existente encuentra sus archivos sin migrar nada) y
`S3FileStorage` para cualquier almacén compatible — AWS S3, Cloudflare R2, MinIO, Backblaze B2.
Los dos servicios pasaron a depender del puerto; la clave de objeto se arma en un solo lugar
(`fileKey`).

**La firma SigV4 está escrita a mano** (`s3-signer.ts`, 15 tests): el SDK de AWS arrastra decenas
de paquetes transitivos para lo que acá son dos operaciones sobre HTTP, y el repositorio ya
resuelve así lo que puede (hash de contraseñas, rate limit, cabeceras). Equivocarse es ruidoso, no
silencioso: el servidor rechaza la firma.

**Verificado contra MinIO real** (5 tests de integración, salteados si no hay almacén): ida y
vuelta de bytes UTF-8 y binarios, `null` —no excepción— cuando la clave no existe, sobrescritura, y
que un secreto incorrecto falle con el detalle del servidor. Y de punta a punta sobre el stack de
producción: se subió una foto por la API en contenedor, **el objeto apareció en MinIO bajo
`<tenant>/<file>` y el contenedor de la API quedó sin `/app/.data`**, con la imagen sirviéndose de
vuelta por su URL firmada (200, PNG íntegro).

*Nota:* con `STORAGE_DRIVER=local` en producción el arranque avisa explícitamente que los archivos
se pierden en el próximo deploy.

#### H-12 · ALTO — El email no se envía de verdad · **CORREGIDO** (paso 1.4)

`LogEmailSender` imprimía el correo al log y era el **único** adaptador del puerto `EmailSender`:
en producción, la verificación de email y el reset de contraseña quedaban rotos — el usuario nunca
recibía el link.

*Corrección:* `SmtpEmailSender` (`EMAIL_PROVIDER=smtp`). SMTP y no un adaptador por proveedor,
así sirve con SES, Postmark, Mailgun, Resend, Gmail o un relay propio sin código nuevo. 8 tests de
configuración (falla al arrancar si falta `SMTP_HOST`/`SMTP_FROM`, si hay usuario sin contraseña o
si el puerto es inválido; TLS implícito en 465 y STARTTLS en 587, con override).

**Verificado contra un servidor SMTP real** (Mailpit; 3 tests de integración salteables): conexión
validada sin enviar, entrega con destinatario/asunto/cuerpo intactos, y fallo con error —no en
silencio— contra un host caído. Y de punta a punta: `POST /v1/forgot-password` contra la API en
contenedor **entregó el correo con el link de reset funcional**.

*Dependencia nueva:* `nodemailer`, la única que se sumó, y **sin dependencias propias**.
Implementar SMTP a mano (EHLO, STARTTLS, AUTH, DATA, más las rarezas de TLS de cada proveedor) es
el tipo de código que falla en producción contra un proveedor concreto y no en los tests.

*Nota:* con `EMAIL_PROVIDER=log` en producción el arranque avisa exactamente qué queda sin efecto.

#### H-13 · MEDIO — Push desactivado · **PENDIENTE** → paso 3.2

`PUSH_ENABLED=false`: el motor, el ledger y el transporte están construidos y probados, pero el
procesador no arranca. Necesita un *dev build* del móvil (Expo Go no recibe push) y credenciales
de EAS.

#### H-14 · MEDIO — RLS no ejercitada en desarrollo

Ya conocido y mitigado: PGlite conecta como superusuario y **saltea** la RLS, así que las policies
se crean pero nunca se prueban localmente. El job `verify-tenant-isolation` del CI lo cubre contra
PostgreSQL real con un rol no privilegiado, y el guardarraíl `rls-coverage.guardrail` obliga a
decidir explícitamente por cada tabla nueva. Sin acción: el diseño ya es correcto.

### 2.3 Indicadores de calidad que se movieron para el lado malo

No son errores, pero son la señal temprana de uno:

- **`herd.service.ts`: 1417 líneas** (baseline del repo: 340). Le siguen `repro` (961), `health`
  (696), `costing` (648), `tasks` (630). Ningún servicio de 1400 líneas se mantiene revisable.
- **Duplicación 4.17 % → 5.36 %** (221 clones). jscpd ve clones sintácticos; el riesgo real es que
  una regla de negocio termine escrita dos veces, que es justo lo que el proyecto decidió no hacer.

---

## 3. Estado funcional: 36 de 40 módulos del catálogo

Contrastado con `docs/Cowinance_Catalogo_Modulos.docx` (11 suites, 40 módulos) y verificado contra
las rutas reales de la API (`apps/api/src/modules`, 35 módulos) y de la web (61 páginas).

| Suite | Entregado | Falta |
|---|---|---|
| **A · Núcleo** (6) | A1 admin/facturación SaaS · A2 identidad · A3 configuración · A4 sync offline · A5 alertas · A6 documentos | — |
| **B · Ganadería** (6) | B1 hato · B2 reproducción+genética · B3 sanidad · B4 producción/GDP · B5 nutrición · B6 trazabilidad | — |
| **C · Sistemas productivos** (4) | C1 tambo · C2 feedlot · C3 cría y recría | **C4 marketplace** (Fase 4) |
| **D · Agricultura y tierra** (4) | D1 cultivos · D2 pastoreo · D3 mapas/GPS | **D4 clima** (Fase 2-3) |
| **E · Cadena de suministro** (4) | E1 inventarios · E2 maquinaria · E3 mantenimiento · E4 combustible | — |
| **F · Comercial** (5) | F1 compras · F2 ventas · F4 clientes · F5 proveedores | **F3 CRM** (Fase 2-3) |
| **G · Finanzas** (4) | G1 contabilidad · G2 costos · G3 tesorería | **G4 facturación electrónica** (Fase 2-3) |
| **H · Personas** (2) | H1 RRHH · H2 nómina/jornales | — |
| **I · Laboratorio** (1) | I1 LIMS | — |
| **J · Datos e IA** (4) | J1 reportes | J2 BI, J3 IA, J4 gemelo (Fase 3-4) |
| **K · Ecosistema** (5) | — | K1 IoT, K2 drones, K3 blockchain, K4 academia, K5 integraciones (Fase 3-4) |

**Fase 2 del roadmap está a 3 módulos de cerrar: D4 clima, F3 CRM, G4 facturación electrónica.**
Todo lo demás pendiente es Fase 3-4 y no pertenece al producto final de esta etapa.

Paridad móvil (offline-first): hato, manga, sanidad, reproducción, tareas, agenda, notificaciones y
captura están en el móvil. Diferido: los 7 modos de manga en móvil (la web los tiene).

---

## 4. Qué falta para el producto final

Orden por dependencia, no por preferencia: sin el paso 1 no hay producto que mostrar, aunque el
software esté completo.

### Paso 1 — Despliegue (lo que separa «funciona» de «existe»)

1. ~~**`Dockerfile` para API y web** + `docker-compose.prod.yml`.~~ **HECHO** — ver H-8.
2. ~~**Migraciones versionadas.**~~ **HECHO** — ver H-10.
3. ~~**Almacenamiento de objetos** (S3/R2).~~ **HECHO** — ver H-11.
4. ~~**Adaptador de email real.**~~ **HECHO** — ver H-12.
5. ~~**Pipeline de deploy.**~~ **HECHO** — `.github/workflows/release.yml`: corre después de los
   gates de CI, construye las dos imágenes, **levanta el stack con esas imágenes exactas** contra
   PostgreSQL real, espera `readyz` (la señal de que el esquema cargó y las migraciones se
   aplicaron, no un `sleep`), comprueba login + lectura + web, y **recién entonces** publica en
   GHCR etiquetado con el SHA. El mismo `docker-compose.prod.yml` sirve para desplegar la imagen
   publicada (`API_IMAGE=… up -d --no-build`), así lo que se despliega es exactamente lo que se
   probó. *Verificado localmente*: la secuencia completa de humo pasa y los contenedores corren
   la imagen candidata, no una reconstrucción.
6. ~~**Backups y restore probado.**~~ **HECHO** — `deploy/backup/{backup,restore}.sh` +
   `npm run verify:backup`, también como job de CI. El verificador no comprueba que `pg_dump`
   corra: respalda, **DESTRUYE la base** (`DROP DATABASE`), restaura, compara fila por fila y
   **arranca la app contra lo restaurado** para hacer login y leer. *Verificado*: 62 animales,
   578 eventos, 363 pesajes y las 9 migraciones volvieron idénticos; la vista derivada
   `v_weighings` —de la que depende la GDP en todos los canales— volvió con sus 363 filas; y
   `/dashboard/home` compuso sobre la base restaurada.
   Dos decisiones que evitan errores caros: el dump usa el rol **administrativo**, porque con el
   de servicio la RLS lo dejaría **vacío en silencio**; y el restore exige `RESTORE_CONFIRM=si`,
   porque el error más caro es ejecutarlo apuntando por accidente a producción.

**Con esto el paso 1 queda cerrado: el producto es desplegable.**

### Paso 2 — Endurecimiento

1. **Observabilidad**: logs estructurados con `request_id` + tenant, métricas y trazas. Hoy el
   diagnóstico en producción sería leer texto suelto.
2. **Ejercitar la RLS en el pipeline de despliegue**, no solo en CI: la garantía de aislamiento es
   la promesa central de un SaaS multi-tenant.
3. **Cookies `HttpOnly`** vía route handler de Next. Cierra **H-6**.
4. **Rate limit compartido** (Redis) cuando haya más de una instancia. Cierra el límite conocido de **H-2**.
5. **Presupuesto de tamaño por servicio**: partir `herd.service.ts` (1417 líneas) por caso de uso.
   Elegir el umbral y ponerlo en `audit:arch` como gate, no como indicador.

### Paso 3 — Cerrar Fase 2 funcional (3 módulos)

1. **D4 · Clima y agrometeorología** — ingesta de estación/API meteorológica, series por finca,
   índices agroclimáticos. Es el más barato y el que más módulos ya construidos alimenta
   (pastoreo, cultivos, alertas).
2. **G4 · Facturación electrónica** — el de mayor valor comercial y el único con requisito
   regulatorio por país (AFIP/ARCA en AR). Depende de G1, que ya está.
3. **F3 · CRM** — pipeline comercial sobre `business_partners`, que ya existe. El de menor riesgo.
4. **Push activo** (H-13): dev build del móvil + EAS.
5. **Paridad de los 7 modos de manga en móvil.**

### Paso 4 — Producto, no software

1. **Onboarding real**: hoy un tenant nuevo arranca vacío. Importador guiado + datos de ejemplo
   opcionales + primeros pasos por rol.
2. **Verificar los planes de facturación end-to-end** con un proveedor de pagos.
3. **Beta con un socio de diseño** (`docs/product/design-partner-strategy.md`) sobre datos reales:
   es lo único que revela si el modelo de datos aguanta una finca de verdad.
4. **Medir performance con volumen real** — 10.000 animales, 5 años de eventos. El perfilado previo
   (Fase 3 de la auditoría anterior) se hizo sobre el dataset demo de 57 animales.

---

## 5. Qué cambió en esta auditoría

| Archivo | Qué |
|---|---|
| `apps/api/src/modules/auth/jwt-secret.ts` (+test) | H-1 · la API no arranca en producción sin clave propia |
| `apps/api/src/common/rate-limit.ts` (+test) | H-2 · ventana deslizante pura |
| `apps/api/src/common/rate-limit.guard.ts` | H-2 · guard global, activo solo con `@RateLimit` |
| `apps/api/src/common/passwords.ts` (+test) | H-3 · esquema `s3`, async, re-hash transparente, guarda de longitud |
| `apps/api/src/common/http-hardening.ts` (+test) | H-4/H-5 · CORS por lista, cabeceras, `trust proxy` |
| `apps/api/src/modules/ops/` | H-9 · `healthz` / `readyz` |
| `apps/api/src/main.ts` | cablea el endurecimiento |
| `apps/api/src/modules/auth/*.ts`, `identity.controller.ts` | `@RateLimit` en los 7 endpoints públicos de credenciales |
| `.env.example` | H-8 · las 13 variables documentadas, con las obligatorias marcadas |
| `package-lock.json` | H-7 · `npm audit fix` (Next 15.3 → 15.5.21) |
| `packages/db/migrations/0001…0008.sql` | H-10 · las 7 constantes de DDL de `db.service.ts` + el fix del plano de identidad, ahora versionadas |
| `apps/api/src/db/migrations.ts` (+test) | H-10 · corredor con `schema_migrations`, checksum y transacción por migración |
| `apps/api/src/db/db.service.ts` | H-10 · 588 → 229 líneas; `DATABASE_URL` obligatoria en producción |
| `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore` | H-8 · imágenes multi-etapa, usuario no-root, healthcheck |
| `docker-compose.prod.yml`, `deploy/postgres-init/` | H-8 · stack de referencia con rol de servicio restringido |
| `apps/web/next.config.ts` | H-8 · `output: 'standalone'` para que la imagen de la web no arrastre el monorepo |
| `application/ports/file-storage.port.ts`, `infra/storage/` (+3 tests) | H-11 · puerto + adaptadores local y S3, con SigV4 propio |
| `modules/media/`, `modules/documents/` | H-11 · los dos escritores pasan por el puerto; se elimina el camino duplicado |
| `infra/email/smtp-email-sender.ts` (+2 tests) | H-12 · envío real por SMTP |
| `docker-compose.prod.yml`, `.env.example` | H-11/H-12 · las variables de S3 y SMTP, documentadas |
| `.github/workflows/release.yml` | paso 1.5 · build → humo sobre el stack real → publicación en GHCR |
| `deploy/backup/{backup,restore}.sh`, `scripts/verify-backup.mjs` | paso 1.6 · respaldo, restore y el ensayo que los prueba |
| `.github/workflows/ci.yml` | paso 1.6 · `verify:backup` como job |
| `docker-compose.prod.yml` | paso 1.5 · `API_IMAGE`/`WEB_IMAGE` para desplegar sin reconstruir |

**Verificación tras los cambios: 980 tests verdes, typecheck limpio (5 proyectos + web), build de
producción OK, 0 ciclos, y el stack de contenedores levantado de punta a punta contra
PostgreSQL 17 + PostGIS con la RLS enforceada.**
