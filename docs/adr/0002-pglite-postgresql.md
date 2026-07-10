# 0002 — PGlite en desarrollo, PostgreSQL como modelo canónico

- **Estado:** aceptado (retrospectivo — documenta una decisión de inicio del proyecto, ya construida y verificada en el camino de desarrollo)
- **Fecha:** decisión de fundación; ADR redactado en el Foundation Hardening Sprint, Fase 8
- **Contexto relacionado:** [[0001-modular-monolith]], [[0003-offline-first]]

## Contexto

Cowinance necesita un modelo relacional rico (140 tablas, RLS multi-tenant, funciones de ventana,
`jsonb`, tipos geográficos) y, a la vez, un arranque de desarrollo **sin fricción** (sin instalar ni
administrar un servidor de base de datos) que ejercite **el mismo SQL** que correría el destino de
producción. Un motor distinto en dev (p. ej. SQLite) divergiría en dialecto y features y escondería
bugs hasta producción.

## Decisión

**Un único DDL canónico escrito para PostgreSQL** (`packages/db/cowinance_schema.sql`, 140 tablas)
como fuente de verdad del esquema. En **desarrollo** se corre **PGlite** (PostgreSQL embebido en el
proceso, WASM) cargando ese mismo DDL con **degradaciones documentadas**; el **destino de
producción** es PostgreSQL 17 completo.

### Estado actual (implementado y verificado)
- DDL canónico único de 140 tablas, dialecto PostgreSQL.
- Dev corre sobre PGlite, cargando el DDL con dos degradaciones explícitas y acotadas
  (`db.service.ts`): se **omiten las líneas `CREATE EXTENSION`** y los tipos `geography(...)` se
  **reemplazan por `jsonb`** (PGlite no trae PostGIS).
- Sobre PGlite se ejercita SQL real de PostgreSQL: **RLS forzada** por tenant, funciones de agregado
  y ventana (dashboard/reportes), `jsonb`, `LATERAL`, transacciones.
- Semilla de datos demo idempotente; RLS validada por `auth-e2e` (aislamiento entre tenants).

### Evolución futura (roadmap, NO construido)
- **Despliegue real sobre PostgreSQL 17** (hoy **no existe** un entorno de producción desplegado; no
  hay remoto Git ni CI — todo vive local).
- **PostGIS** (tipos `geography` reales en lugar de la degradación a `jsonb`), **TimescaleDB**
  (hypertables para `sensor_readings`/`gps_positions`) y **`pg_uuidv7`** (UUID v7 ordenables) —
  presentes como comentarios/recomendaciones en el DDL, **no ejercitados** todavía.

## Alternativas consideradas

- **SQLite en desarrollo.** Descartada: dialecto y features divergen fuerte de PostgreSQL (sin RLS,
  sin `jsonb` equivalente, sin funciones de ventana completas) — escondería incompatibilidades hasta
  producción.
- **Un esquema de desarrollo separado / simplificado.** Descartada: dos fuentes de verdad del modelo
  → deriva garantizada entre dev y prod.
- **Base de datos mockeada / en memoria no-SQL.** Descartada: no ejercita el SQL ni la RLS reales;
  los bugs de consulta aparecerían recién en integración.
- **Exigir un PostgreSQL local instalado.** Descartada para dev: fricción de arranque (instalar,
  administrar, versionar) sin beneficio sobre PGlite, que ES PostgreSQL embebido.

## Consecuencias positivas

- **Mismo modelo relacional local y remoto:** un solo DDL como fuente de verdad; el SQL que se
  escribe en dev es el que correría en prod (salvo las degradaciones acotadas).
- **Semántica real de PostgreSQL en desarrollo:** RLS, `jsonb`, ventanas, `LATERAL`, transacciones —
  no una aproximación.
- **Arranque sin fricción:** cero instalación de base de datos; PGlite levanta en el proceso.
- **Camino a producción claro:** el mismo DDL, quitando las degradaciones, es el esquema de prod.

## Consecuencias negativas

- **PGlite tiene una sola conexión:** las transacciones se serializan y son delicadas (riesgo R2 del
  sprint) — el refactor de sync tuvo que respetar las fronteras de tx con cuidado.
- **Brecha dev↔prod en los tipos degradados:** `geography` corre como `jsonb` en dev, así que la
  lógica geoespacial real (PostGIS) **no se ejercita** localmente; TimescaleDB tampoco. Es una
  brecha conocida, no un problema hoy (Fase 1 ganadera no usa geoespacial intensivo).
- **Compatibilidad PostgreSQL diseñada, no probada end-to-end:** al no haber un despliegue real
  todavía, la equivalencia dev↔prod es una propiedad de diseño (mismo DDL) que resta validar contra
  una instancia PostgreSQL real.
