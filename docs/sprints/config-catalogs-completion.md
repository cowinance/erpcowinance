# Cierre de sprint — Configuración · Catálogos maestros (A3, 1ª entrega)

**Estado:** COMPLETO. Primera entrega del módulo **A3 · Configuración y catálogos maestros [Fase 0-1]**,
que hasta ahora era un **placeholder** (`/modulo/configuracion`). Módulo `config` propio.

## 1. Qué se construyó

- **Página real `/configuracion`** (reemplaza el placeholder; el sidebar ahora apunta ahí) con 5
  pestañas: Razas, Diagnósticos, Categorías, Unidades, Especies.
- **Catálogos editables (extensión por tenant):**
  - **Razas** (`breeds`): alta/baja de razas propias por especie (código, nombre, aptitud). La base
    global (Angus, Hereford, etc.) es de solo lectura.
  - **Diagnósticos** (`diagnoses`): alta/baja de diagnósticos propios (código, nombre, categoría,
    notificable). Tabla vacía en el demo → el tenant crea los suyos.
- **Catálogos de solo lectura (globales):** Especies, Categorías zootécnicas, Unidades de medida.
- **API** `GET /config/catalogs`, `POST/DELETE /config/breeds`, `POST/DELETE /config/diagnoses`.

## 2. Modelo de tenancy (hallazgo clave)

Los catálogos tienen dos modelos distintos en el esquema:
- **`breeds` y `diagnoses`:** `tenant_id` **nullable** → `NULL` = base global compartida; `tenant_id`
  seteado = entrada propia del tenant. UNIQUE incluye `tenant_id`, así que un tenant puede tener su
  propio código sin chocar con la base. **Son los que admiten extensión por tenant.**
- **`animal_categories`, `units`, `species`:** SIN `tenant_id` → globales. Editarlas afectaría a todos
  los tenants, por eso van **solo lectura**.

## 3. Regla única (dominio)

- **`validateBreedInput` / `validateDiagnosisInput`** (`packages/domain/src/config/catalog.ts`):
  normalizan y validan (código obligatorio ≤64, nombre obligatorio, aptitud en enum). Error de dominio
  `InvalidCatalogEntryError` → 400 en el servicio.

## 4. Decisiones importantes

- **Scoping por servicio (no RLS).** Estas tablas **no tienen RLS**. El filtro `tenant_id IS NULL OR =
  tenant` se aplica en `CatalogsService`; el borrado exige `tenant_id = tenant` (nunca se tocan las
  entradas base ni las de otro tenant → 404). Un `editable` derivado (`tenant_id IS NOT NULL`) le dice
  a la UI qué filas son propias.
- **Unicidad → 409** (código PG `23505`), validación de dominio → 400, especie inexistente → 400.
- **Módulo `config` propio**, bounded context (0 ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **612 tests** (desde 601 → +6 dominio, +5 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios (ver riesgo abajo) |
| Verificación web | alta de raza «Limousin» → aparece «Propia» con borrar; base «Base» sin borrar; end-to-end OK |

## 6. Riesgo / trabajo diferido

- **RLS de catálogos con tenant nullable (IMPORTANTE):** `breeds`/`diagnoses` no tienen RLS y su
  `tenant_id` es nullable. La política estándar (`tenant_id = app.tenant_id`) **no sirve** porque
  ocultaría la base global (`tenant_id IS NULL`). El fix correcto es una política BESPOKE
  `USING (tenant_id IS NULL OR tenant_id = app.tenant_id) WITH CHECK (tenant_id = app.tenant_id)` (como
  import_batches). No se aplicó ahora porque el bootstrap siembra la base global con `tenant_id NULL`
  y habría que permitir esos inserts bajo FORCE RLS. Hoy el aislamiento lo garantiza el servicio; la
  defensa en profundidad a nivel DB queda **diferida**.
- **Más catálogos:** países, monedas, tipos de cambio (multi-moneda), unidades editables por tenant.
- **Categorías zootécnicas por tenant:** requeriría agregar `tenant_id` a `animal_categories`.
- **Feature flags, parámetros de negocio (system_settings), motor de reglas** — otras partes de A3.

## 6-bis. Moneda de la finca (2ª entrega)

- **Pestaña «Moneda»** en `/configuracion`: muestra la moneda operativa actual y permite cambiarla a
  cualquier código del catálogo `currencies` (ARS, USD, UYU, MXN, COP, BRL — ya sembrados).
- **API** `GET /config/currency` (org + empresas + catálogo) y `PUT /config/currency` (cambia
  `organizations.default_currency` y `companies.functional_currency` del tenant).
- **Regla única (dominio):** `normalizeCurrencyCode` (ISO 4217, 3 letras, mayúsculas). Código fuera del
  catálogo → 400.
- **Decisión:** la moneda es hacia adelante — los documentos ya emitidos (payments/invoices) conservan
  su `currency` registrada; solo cambian los defaults para lo nuevo.
- **Aplicado:** el tenant demo se pasó de **ARS → USD** (verificado en la web: organización y empresa
  «La Esperanza S.A.» muestran USD). El seed de fábrica sigue naciendo en ARS/AR; esta pantalla es la
  vía para operar en USD.

## 7. Estado del roadmap

**Configuración · Catálogos maestros + Moneda → COMPLETAS.** El módulo dejó de ser placeholder.

**Siguiente en A3 (a elección):** monedas y tipos de cambio (desbloquea multi-moneda de Tesorería),
feature flags por tenant, o parámetros de negocio. También pendiente el hardening de RLS de los
catálogos con tenant nullable.
