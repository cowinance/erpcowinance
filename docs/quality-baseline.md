# Baseline de métricas de calidad — Foundation Hardening Sprint

**Refrescado en F9** (cierre del sprint). Este documento es el punto de referencia
contra el que `npm run audit:arch` compara. Se actualiza de forma **consciente**
cuando un número cambia a propósito — nunca automáticamente.

> El baseline original de F0 (34 tests, 1 ciclo, `sync.service` 581 líneas, jscpd 0.89%)
> quedó obsoleto tras F1-F8. Se conserva su intención; los números de abajo son los de cierre.

## Dos categorías (filosofía de `audit:arch`)

- **Architecture Gates** → invariantes que **nunca** deben romperse. `audit:arch` **bloquea**
  (exit ≠ 0) si alguno falla. Binarios y no arbitrarios.
- **Quality Indicators** → señales que **ayudan a decidir**. `audit:arch` los imprime con su
  delta vs. este baseline, pero **nunca bloquea** por ellos. No se optimizan números por optimizar;
  se protege arquitectura.

`audit:arch` es **estático y rápido** (sin servidor). Los gates de runtime —`auth-e2e` (15/15),
`sync-e2e` (19/19), simulación de convergencia (2000/2000)— requieren la API corriendo y quedan
**fuera** de `audit:arch` a propósito; se corren por separado.

## Architecture Gates (bloquean)

| Gate | Herramienta | Estado de cierre | Umbral | Justificación / riesgo que evita |
|---|---|---|---|---|
| **Typecheck** | `tsc --noEmit` (domain, sync-core, api, mobile) | limpio | pasa | No compila = roto. Cubre el typecheck sin instalar ESLint (decisión F9). |
| **Tests** | `vitest run` | **106 verdes** (14 archivos) | 100% pasan | Un test roto = comportamiento roto. |
| **Ciclos de dependencia** | `madge --circular` | **0** | **= 0** | Un ciclo rompe el DAG que sostiene la arquitectura (ADR-0001/0008): acoplamiento oculto, capas rotas. Nunca aceptable. |

## Quality Indicators (informan, no bloquean)

| Indicador | Herramienta | Baseline de cierre | Estrategia de evolución |
|---|---|---|---|
| **Cobertura** (acotada a `domain` + `sync-core`) | `vitest --coverage` | **72.54%** (428/590 líneas) | Meta reportada: dominio ≥ 90% (hoy el dominio puro está ~100%; `sync-core` la baja — `device.ts` sub-cubierto, `types.ts` es solo interfaces = 0% esperado). **La api se prueba por E2E, no por vitest** — su baja cobertura vitest es esperada, no una brecha; por eso el indicador NO cuenta la api (un número repo-wide daría ~9%, engañoso). Subir la meta cuando se agreguen tests; nunca bloquear por un branch trivial. |
| **Duplicación** | `jscpd` (`api/src` + packages) | **4.17%** (16 clones) | Subió respecto al 0.89% de F0 por los 5 handlers de eventos de F6 (INSERTs de forma casi idéntica → clones **sintácticos**, no semánticos). jscpd **no** ve la duplicación que importa (reglas de negocio en varios lugares) — esa la enforcea la revisión y la Regla Permanente 1, no el tool. Vigilar tendencia, no perseguir el número. |
| **Tamaño de archivos** (God-object watch) | conteo de líneas (`apps/api/src`) | servicio más grande **340** (`alerts.service.ts`); `sync.service` **272** (era 581 pre-F6) | Detecta reaparición de God-objects — lo que detectó el problema fue el tamaño, no la complejidad ciclomática. Alertar si algo crece anómalamente. (`seed.ts` 453 es data, no un servicio.) |

## Cómo correr

```bash
npm run audit:arch      # gates + indicadores; exit ≠ 0 solo si un GATE falla
```

Gates de runtime (aparte, requieren `npm run api`):
```bash
node apps/api/scripts/auth-e2e.mjs   # 15/15
node apps/api/scripts/sync-e2e.mjs   # 19/19
npm run sim -w @cowinance/sync-core  # 2000/2000
```

## CI

No hay CI todavía (todo vive local, sin remoto). `audit:arch` es **CI-ready**: un futuro CI solo
necesita ejecutarlo y leer el exit code. Instalar CI es backlog, no parte de F9.
