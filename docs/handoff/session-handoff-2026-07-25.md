# Cowinance — Handoff de sesión

**Fecha:** 2026-07-25
**Rama:** `main` · último commit `89552aa`
**Para:** quien retome el proyecto sin haber estado en esta sesión

Este documento cuenta **qué pasó, en qué estado quedó y qué sigue**. El handoff anterior
([2026-07-10](session-handoff-2026-07-10.md)) sigue siendo la referencia de la Fase Producto (P1.x);
éste no lo reemplaza, lo continúa.

---

## 1. Dónde está el proyecto

**35 de 45 módulos del catálogo entregados.** El dominio está prácticamente completo; lo que falta
no es funcionalidad ganadera sino **operación**: que el despliegue del productor esté bien
configurado. Ver §5, que es lo único con trabajo abierto ahora mismo.

Estado técnico al cierre: **1256 tests unitarios/integración + 40 specs e2e (43 casos) en verde**,
`npm run audit:arch` OK, 15 migraciones versionadas.

---

## 2. Lo que se hizo en esta sesión

Arrancó con una auditoría completa ([`docs/audits/auditoria-2026-07-24.md`](../audits/auditoria-2026-07-24.md))
y su plan de 4 pasos. Se ejecutaron los pasos 1 a 3.

### Paso 1 — el producto pasa a ser desplegable (CERRADO)
Seguridad (`a2219e7`), migraciones versionadas + imágenes de producción (`463fccb`), S3 y SMTP
reales (`44ce987`), pipeline de release con humo sobre el stack real y **backup con restore
ensayado** (`cd511f2`).

### Paso 2 — observabilidad y endurecimiento (4/5)
`request_id`, logs estructurados y métricas Prometheus (`1d3fadf`); sesión en cookies HttpOnly,
rate limit compartido en Postgres y techo de servicio (`baad48e`).
**Pendiente:** ejercitar RLS en el pipeline de despliegue, no solo en CI.

### Paso 3 — módulos de Fase 2
- **D4 · Clima** (`34578fc`): índices agroclimáticos derivados (GDD, THI, balance hídrico), con dos
  escalas de estrés (lechería vs carne).
- **F3 · CRM** (`b535686`): pipeline ponderado por etapa, interacciones inmutables, contratos con
  vigencia derivada.
- **Paridad de manga** (`1561e0a`): la brecha no eran los modos —ya estaban— sino la tarjeta del
  animal. `mangaCardAlerts` en el dominio, compartida por web y móvil.

**Queda solo G4 · facturación electrónica** para cerrar la Fase 2. Está **bloqueado por una decisión
del productor**: el país define el modelo de datos (AFIP/ARCA, DIAN, SII, SAT). No arrancarlo sin esa
respuesta.

### Vertical 22 — inventario criogénico (GT-1 … GT-4), COMPLETO
Nació de un pedido del productor: *«tanque de nitrógeno donde se guardan las pajuelas de semen y
embriones; en el tanque 003 hay tres canastas de color azul enumeradas»*.

| Etapa | Commit | Qué entregó |
|---|---|---|
| GT-1 | `18d1683` | termo → canasta → gobelete, con color. Despertó `storage_tanks`, una **tabla dormida** |
| GT-2 | `fcd007e` | cada pajuela una unidad con identidad; el saldo pasa a **derivado** |
| GT-3 | `cd4ed23` | plan de servicio por animal, con **reserva** de la pajuela y lista de retiro |
| GT-3b | `48d6430` | la campaña cierra en el **diagnóstico de preñez**; tasa de concepción por toro |
| GT-4 | `a319506` | nitrógeno: consumo derivado, proyección de vacío y alerta |

El lazo quedó cerrado entero: **pajuela → vaca → preñez → tasa por toro → qué semen se vuelve a
comprar**, con el termo protegido para que nada de eso se pierda mientras tanto.

Detalle de decisiones en [`docs/sprints/`](../sprints/) y en la memoria del proyecto.

### Correcciones a reportes del productor
- **Verificación de email** (`fea26f1`): los dos botones siempre funcionaron; lo que fallaba era que
  el servidor no envía correo (`EMAIL_PROVIDER=log`) y que la UI callaba el resultado. Ahora
  `/auth/me` expone `email_delivery` y el banner lo dice.
- **Menú en el registro** (`c696def`): el sidebar se dibujaba en el layout raíz sin condición.
  `/login` lo tapaba con un `fixed inset-0`; `/register` no.
- **Layout en teléfono** (`d0c1c5b`) y **crash del móvil en el harness web** (`0110f82`).
- **Guardia de arranque de la web** (`89552aa`): ver §5.

---

## 3. Reglas de arquitectura que se reforzaron

Valen más que los módulos: son las que hay que respetar al seguir.

- **Una sola fuente por número.** Se eliminaron los contadores `straws_available`: el saldo se
  cuenta desde las unidades. Un contador *y* unos hechos son dos fuentes que un día no coinciden —
  el bug que ya costó caro con `LEDGER_COUNTS` en presupuestos.
- **Lo derivado no se guarda.** Consumo de nitrógeno, días restantes, resultado de la campaña, tasa
  por toro: todo se calcula. No hay columna que se pueda desincronizar.
- **La regla de negocio vive en `packages/domain`.** Si dos canales la necesitan, va ahí:
  `mangaCardAlerts`, `cryoLocationLabel`, `computeNitrogenState`, `summarizeCampaignOutcome`.
- **Un despliegue mal configurado muere al arrancar.** `JWT_SECRET`, `DATABASE_URL`, y ahora la web
  con su guardia. Donde lo ve quien despliega, no meses después donde lo sufre un usuario.

---

## 4. Gotchas que costaron tiempo (no repetirlos)

- **`NEXT_PUBLIC_API_URL` se inlinea en el build**, no se lee en runtime. Reconstruir la imagen sin
  pasarla deja la web apuntando a `localhost` y rompe el registro. Hay guardia (§5).
- **Next ATRAPA lo que lance `instrumentation.register()`** y sigue sirviendo. Para abortar el
  arranque hay que `process.exit(1)`.
- **PGlite: el mismo parámetro en asignación y comparación** falla con «inconsistent types deduced».
  Castear (`$3::text`).
- **PGlite se corrompe si se mata el proceso con `-9`.** Pasó tres veces; se recrea con
  `rm -rf apps/api/.data/pglite`. No afecta a producción, que usa PostgreSQL real.
- **Los diagnósticos se registran con FECHA** (medianoche). Compararlos contra un `timestamptz`
  exacto pierde los del mismo día: comparar `::date`.
- **En e2e, escribir antes de que React hidrate** deja el DOM lleno y el estado vacío: el formulario
  se ve completo y el botón sigue deshabilitado. Esperar a `networkidle` o a un post-estado real.
- **La tabla de artículos es `inventory_items`**, no `items`; `unit` es FK a `units`.
- **`recordMovementInTx` devuelve `{movement, level}`**, no la fila suelta.
- **Rutas estáticas antes de las paramétricas**, o nunca se alcanzan.

---

## 5. LO ÚNICO ABIERTO: la configuración del servidor del productor

El despliegue en `app.cowinance.com` **funciona**, pero quedaron dudas sin cerrar. Esto es lo
primero que hay que retomar.

### Resuelto y verificado en producción
- El menú ya no aparece en `/register`, `/login` ni `/forgot-password` (0 `<aside>`).
- El catálogo de países carga (200) y «Crear cuenta» está habilitado.

### La base: el productor creó una RDS en AWS (25 jul, final de la sesión)
Confirmó que **no hay datos importantes que migrar**, así que se puede apuntar directo. Le quedaron
dados los pasos: extensiones `pgcrypto` y `postgis` con el usuario maestro, rol `cowinance_app`
(`NOSUPERUSER NOBYPASSRLS`), bajar la CA de RDS y armar el `.env` con `NODE_ENV=production`, las dos
URLs y `DATABASE_SSL_CA` (ver §8). Sacar el servicio `db` del compose y su `depends_on`.

**Sin responder:** dónde corre la API ahora (¿se movió a AWS o sigue en el servidor de siempre?) y si
el security group de la RDS deja entrar desde ahí.

### Sin confirmar — preguntar antes de seguir
El productor dijo que **tuvo que arrancarlo «en modo prueba»**. Si eso significa que `NODE_ENV` no
es `production`, quedaron apagadas de golpe: `JWT_SECRET` obligatoria (¡acepta la clave de
desarrollo, que es pública!), CORS cerrado, el token de métricas, y sobre todo **la base**: sin
`DATABASE_URL` la API corre sobre PGlite, en el disco efímero del contenedor, y **pierde todo en el
próximo deploy**.

Comandos para saber en qué estado está:

```bash
docker compose -f docker-compose.prod.yml exec api printenv NODE_ENV DATABASE_URL SEED_DEMO
docker compose -f docker-compose.prod.yml logs api | grep -i "Base:"
```

`Base: PostgreSQL real (DATABASE_URL)` = está bien. Si esa línea no aparece, está en PGlite.

**Si hay datos que conservar, migrarlos ANTES de levantar el stack con la base real** — la nueva
arranca vacía. Y si `SEED_DEMO` estaba en `on`, hay 57 animales demo mezclados.

### Además, sin configurar todavía
| Variable | Consecuencia de dejarla como está |
|---|---|
| `EMAIL_PROVIDER=log` | el correo se imprime: **no llega** la verificación ni el reset |
| `APP_BASE_URL` | el enlace del correo apunta a `localhost:3000` y no sirve desde el teléfono |
| `STORAGE_DRIVER=local` | fotos y documentos se pierden en el próximo deploy |

---

## 6. Qué sigue, en orden

1. **Cerrar la configuración del servidor** (§5). Es lo único que hoy puede perder datos reales.
2. **Paso 2.2:** ejercitar RLS en el pipeline de despliegue, no solo en CI.
3. **G4 · facturación electrónica** — bloqueado hasta que el productor elija país.
4. **Paso 4 de la auditoría:** onboarding, pagos de punta a punta, beta con design partners y
   **rendimiento con volumen real** (todo lo medido hasta hoy fue sobre 57 animales demo).

### Diferidos conocidos
- UI móvil de Tareas.
- Activación de push (H-13): necesita dev build + credenciales EAS del productor.
- Manga en un teléfono de verdad (se verificó en el harness de navegador, no en dispositivo).
- `herd.lookup` no expone la fecha de retiro de leche; el móvil sí la tiene.
- Partir `herd.service` (1417 líneas).

---

## 7. Cómo retomar

```bash
npm install
npm run api    # http://localhost:3001/v1  (PGlite + seed demo)
npm run web    # http://localhost:3000
npm test && npm run audit:arch
npm run e2e:web
```

El proyecto está **indexado en el grafo de código** (`codebase-memory-mcp`, proyecto
`Users-josemontilla-Proyectos-app-ganadera`, commit `89552aa`): conviene usar `search_graph` /
`trace_path` / `get_code_snippet` antes de leer archivos a mano.

La **memoria de proyecto** (`~/.claude/projects/…/memory/`) tiene una ficha por vertical con las
decisiones que no se deducen del código. Empezar por `MEMORY.md`.

---

## 8. Adenda — TLS contra la base gestionada (RESUELTO)

El productor movió todo a AWS: **API en EC2 y PostgreSQL en RDS**, en la misma VPC. Confirmó que
**no hay datos que migrar**.

Eso destapó que el driver no podía verificar el certificado: `pg` 8.22 interpreta `?sslmode=require`
como `verify-full`, y la CA de RDS no está en el almacén de Node. El único atajo era
`?sslmode=no-verify`, que cifra **sin verificar con quién habla**.

**Resuelto en `84aa508`:** `DATABASE_SSL_CA` acepta la ruta a un archivo o el PEM pegado en la
variable. Si la base es un host remoto y no se pide TLS, el arranque avisa (avisa, no falla: contra
el Postgres del compose exigir certificados sería ceremonia sin riesgo).

### Lo que falta hacer EN LA EC2 (no está hecho)

1. **Sacar el servicio `db` del compose**, su volumen, y el `depends_on:` del `api`. Sin lo último la
   API no arranca: espera a un contenedor que ya no existe.
2. **Bajar la CA y montarla:**
   ```bash
   curl -o rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```
   ```yaml
   volumes:
     - ./rds-ca.pem:/etc/ssl/rds-ca.pem:ro
   environment:
     DATABASE_SSL_CA: /etc/ssl/rds-ca.pem
   ```
3. **En la RDS, con el usuario maestro:** `CREATE EXTENSION pgcrypto; CREATE EXTENSION postgis;` y el
   rol de servicio `cowinance_app` (`NOSUPERUSER NOBYPASSRLS`).
4. **`.env`:** `NODE_ENV=production`, las dos URLs (servicio y admin), `DATABASE_SSL_CA`,
   `SEED_DEMO=false`.

**Ojo:** RDS PostgreSQL reciente trae `rds.force_ssl = 1` por defecto. Si es el caso, sin TLS la
conexión se rechaza de entrada. Verificar con `SHOW rds.force_ssl;`.

Confirmación de que quedó bien:
```bash
docker compose -f docker-compose.prod.yml logs api | grep -iE "Base:|TLS"
npm run verify:pg
```
Tienen que aparecer `Base: PostgreSQL real (DATABASE_URL)` y `TLS con verificación de certificado`.

### Nota sobre el gate que había quedado en rojo
Era **carga de la máquina, no una regresión**: corrían dos suites completas en paralelo (~20 workers)
y el gate de tests con coverage no terminaba. Con la máquina libre, los nueve gates en verde —
1266 tests, 0 ciclos, mayor servicio 1123 sobre un techo de 1150. Si vuelve a pasar: no correr dos
suites a la vez.
