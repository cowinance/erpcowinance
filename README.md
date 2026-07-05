# Cowinance

Plataforma ERP para ganadería, agricultura y administración de fincas. La especificación completa vive en [docs/](docs/) (14 documentos: arquitectura, roadmap, catálogo de 40 módulos, design system, APIs, modelo de datos y módulos funcionales).

## Estado

**Fase 0-1 del roadmap** (alcance funcional de Fase 1 completo en web):
- **Hato**: dashboard, lista maestra, ficha 360° con línea de tiempo y genealogía (madre/padre/crías), captura de pesajes, lookup por caravana.
- **Sanidad**: vacunaciones, tratamientos con cálculo automático de retiros (carne/leche) según el producto, diagnósticos, mortalidad con baja del animal; KPIs (cobertura, retiros activos, mortalidad).
- **Reproducción**: ciclo completo celo → servicio (IA/monta) → diagnóstico (crea la preñez con fecha probable de parto desde el servicio + 283 d) → parto (alta de crías con genealogía) → destete; KPIs y próximos partos.
- **Modo manga** (`/manga`): captura masiva de campo en alto contraste AAA — caravana → peso → condición corporal, con feedback auditivo y contador de progreso.
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

## API (extracto)

Sigue las convenciones del documento de APIs: prefijo `/v1`, paginación por cursor, errores con código de dominio, `Idempotency-Key` en POST.

- `GET /v1/dashboard/kpis` — vitales del dashboard
- `GET /v1/animals?status=&category=&lot=&q=&cursor=` — lista maestra
- `GET /v1/animals/:id` — ficha 360°
- `GET /v1/animals/:id/timeline` — línea de tiempo de eventos
- `POST /v1/animals` — alta de animal
- `POST /v1/animals/:id/events` — evento polimórfico (`weighing`, `note`, …)
- `GET /v1/lots` · `GET /v1/farms` · `GET /v1/organizations/current`

## Limitaciones conocidas (entorno dev)

- **Sin autenticación ni RLS activa**: la API resuelve un tenant único de desarrollo; OIDC + Row-Level
  Security llegan con el módulo de identidad real.
- **`Idempotency-Key` en REST**: se acepta la cabecera pero el dedupe solo está implementado en el canal
  de sincronización (device + seq); en REST es un no-op por ahora.
- **Fechas en UTC**: los cálculos de retiro/parto usan fechas ISO UTC; la presentación por zona horaria
  del establecimiento queda pendiente.
- **Suscripciones parciales**: el bootstrap baja el tenant completo; el filtrado por fincas asignadas al
  dispositivo llega con el módulo de identidad.

## Próximos pasos (según roadmap)

1. Sanidad y Reproducción completos (Fase 1)
2. Autenticación OIDC + RLS multi-tenant real
3. App móvil offline-first (React Native + Expo) con modo manga, usando `@cowinance/sync-core` como cliente
4. Protocolo binario (Protobuf + zstd) para el canal de sync en redes 2G/3G
