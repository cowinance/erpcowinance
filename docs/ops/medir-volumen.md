# Medir cómo escala el sistema

El demo tiene 66 animales. Una finca real tiene entre cientos y miles, y **los problemas de escala
no se ven con datos de demo**: se descubren el primer día que entra un productor con su hato.

Esta guía deja escrito el método que encontró cuatro problemas reales en una tarde.

---

## El método, en una línea

**Medir en dos o tres tamaños, nunca en uno.** Un número suelto no dice nada. Lo que delata un
problema es la CURVA:

| animales | `/dashboard/home` | |
|---|---|---|
| 65 | 49 ms | |
| 1.065 | 990 ms | |
| 3.065 | **7.156 ms** | ← el triple de datos, siete veces el tiempo |

Si el tiempo crece igual que los datos, está bien. Si crece más rápido, hay algo O(n²) adentro.

---

## Cómo correrlo

```bash
# 1. Frenar la API: la base de desarrollo es de un solo proceso.
pkill -f 'nest start'

# 2. Sembrar. CON HISTORIA, no solo animales (ver más abajo por qué).
node apps/api/scripts/seed-volumen.mjs 1000

# 3. Levantar y medir los endpoints calientes.
npm run api
```

Repetir con 3.000 y comparar. Al terminar, `rm -rf apps/api/.data/pglite` devuelve el demo normal.

**Salvedad honesta:** en desarrollo esto corre sobre PGlite, bastante más lento que el PostgreSQL
del servidor. Los milisegundos absolutos **no** se trasladan. La forma de la curva sí, que es lo que
importa: un cuadrático es cuadrático en las dos bases.

---

## Sembrar con FORMA, no solo con tamaño

La primera medición de esta serie agregaba animales y pesajes, nada más. Dio un falso aprobado: el
motor de alertas salió rápido porque esos 3.000 animales **no tenían nada que evaluar**. Una finca
real tiene entre 10 y 50 hechos por animal, y son los hechos —vacunas, tratamientos, servicios,
preñeces, tareas, movimientos— los que hacen trabajar al camino caro del sistema.

El caso más claro: `grazing/performance` tardaba 104 ms con 3.000 animales sin movimientos y
1.521 ms con los mismos animales CON movimientos.

---

## El patrón que apareció tres veces

**Una vista con función de ventana, consultada por fila.**

`v_weighings` deriva la GDP con un `LAG` sobre los pesajes de cada animal. Preguntarle algo desde un
`NOT EXISTS` o un `LATERAL` correlacionado hace que por CADA fila se pague el cálculo de la ventana
entera: O(filas × pesajes).

Apareció en el Inicio (7.156 ms → 147 ms) y en el listado de lotes (5.129 ms → 60 ms, para devolver
SEIS filas). En los dos casos la consulta **no necesitaba la GDP**: quería el último peso o si
existía un pesaje, y las dos cosas están en la tabla base.

> Antes de consultar `v_weighings`, preguntarse si hace falta `adg_since_last`. Si no, va contra
> `weighings`.

El segundo patrón: **una subconsulta correlacionada sin el índice que la sostiene**. La resolución
as-of del lote (`animal_movements` ordenado por `moved_at`) tenía índice por `animal_id` sin
`moved_at`, así que cada consulta ordenaba. Lo arregló la migración `0026`.

---

## Qué se midió y cómo salió

| Superficie | Resultado |
|---|---|
| Inicio, agenda, alertas, animales, costos | lineal ✅ |
| Listados con filtros | lineal ✅ |
| Paginación por keyset | **plana** (61→54 ms en 8 páginas) ✅ |
| Sincronización · push `event` | lineal, ~0,2 ms/op ✅ |
| Sincronización · push `put`/LWW | lineal, ~1 ms/op ✅ |
| Sincronización · pull | 500 changesets en 13 ms, paginado ✅ |

**Sin medir todavía:** el importador con un CSV de miles de filas, que es lo que hace un productor
el primer día.

**Anotado, sin urgencia:** `sync_changesets` crece sin límite (~1,7 KB por changeset) y no hay
política de retención. No es un problema hoy; conviene decidirlo antes de que lo sea.
