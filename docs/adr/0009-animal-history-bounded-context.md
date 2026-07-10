# 0009 — `AnimalHistoryModule`: bounded context permanente para la línea de tiempo del animal

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 6 (F6.3)
- **Contexto relacionado:** [[0008-sync-handler-ownership]]; [[0004-domain-package]] (política de carpetas perezosas — ver §"Excepción" abajo); `docs/domain-language.md` §6 (Event/línea de tiempo)

## Contexto

Al diseñar F6.3 (migrar las 6 tablas evento restantes fuera de `sync.service.ts`), `animal_events` resultó ser la única de las 6 sin dueño obvio. Se investigó antes de decidir, no se asumió:

- **Ya hoy, 3 módulos** (`health`, `repro`, `land`) escriben `animal_events` vía `apps/api/src/common/events.ts` (`insertAnimalEvent`/`requireAnimal`) — funciones planas, sin `@Injectable()`, sin módulo Nest. El propio codebase ya trata esta tabla como algo que no pertenece a un solo dominio.
- El handler de sync para esta tabla no tiene **ninguna** lógica de negocio (payload es JSON opaco) — a diferencia de `treatments` (F4.4/F6.1), que sí tenía una regla real (Server Authority) justificando su ubicación en `health/`.
- El roadmap de producto (`docs/*.docx`, Fase 2+) agrega reproducción avanzada, genética, transferencia embrionaria, producción, IoT e IA — **todos** van a escribir en la línea de tiempo del animal. Ninguno es conceptualmente "herd", "health" ni "repro".

Se evaluaron 3 alternativas de ownership (`herd`, `common`, un módulo dedicado) con esa lente de evolución. `herd` fue descartado: no genera acoplamiento técnico real (el path REST ya es module-agnostic vía `common/events.ts`; el path de sync recibe el op del cliente sin que el emisor dependa de nada), pero sí genera un acoplamiento **simbólico** creciente — cada dominio nuevo que use el timeline quedaría "dependiendo de herd" sin razón conceptual, y en un ERP donde esto lo va a usar prácticamente todo bounded context, esa imprecisión se agrava con cada módulo nuevo. `CommonModule` fue descartado explícitamente: sin un criterio de admisión estricto, se convierte en un segundo God-object — exactamente el problema que ADR-0008 ya resolvió una vez para `sync/`.

## Decisión

**Se crea `AnimalHistoryModule` como bounded context permanente**, dueño de la línea de tiempo del animal — no un lugar de paso para un handler, sino el hogar declarado de todo evento inmutable sobre un animal, sin importar qué dominio lo origina. Es un **subdominio genérico** en el sentido de Evans: un concepto usado transversalmente, con identidad propia (append-only, inmutable, ordenado en el tiempo), que merece nombre y ubicación propios en vez de vivir prestado dentro de otro bounded context.

### Alcance de este cambio (deliberadamente acotado)

1. Crear `AnimalHistoryModule`.
2. Mover **únicamente** `AnimalEventSyncHandler` (no existía como archivo — se crea acá, extraído de la rama `animal_events` de `applyEvent()` en `sync.service.ts`) a este módulo.
3. **No** se toca `common/events.ts` — `insertAnimalEvent`/`requireAnimal` siguen donde están, consumidos igual por `health`/`repro`/`land`. Consolidarlos en `AnimalHistoryModule` es una migración futura distinta, de mayor alcance (tocaría los 3 servicios REST), fuera de este cambio.
4. **No** se modifican `health.service.ts`, `repro.service.ts` ni `land.service.ts`.
5. **No** se introducen imports nuevos entre módulos de dominio: `AnimalHistoryModule` no importa `HealthModule`/`HerdModule`/`ReproModule`, y ninguno de ellos importa `AnimalHistoryModule` (no exporta nada que otro módulo necesite todavía).
6. Mismo patrón de auto-registro de ADR-0008: `AnimalEventSyncHandler` inyecta `SyncHandlerRegistry` (global, vía `SyncRegistryModule`) y se registra en `OnModuleInit()`.

Las otras 5 tablas de la oleada 2 (`weighings`, `vaccinations`, `breeding_events`, `calvings`, `calving_offspring`) **no** se tocan en este cambio — quedan para la siguiente ronda, en `herd`/`health`/`repro` como ya se había diseñado.

### Estructura interna: excepción explícita a la política de carpetas perezosas

```
apps/api/src/modules/animal-history/
  animal-history.module.ts
  sync/
    animal-event-sync.handler.ts
  application/   (vacía — placeholder)
  domain/        (vacía — placeholder)
  infrastructure/(vacía — placeholder)
```

**Esto contradice, a propósito, la Regla Permanente 4 y el precedente de ADR-0004** (*"no se crean carpetas vacías; se crean cuando reciben código real"*). Se documenta la excepción explícitamente, como la propia Regla 4 exige (*"si algo se difiere, documentarlo en un ADR"*), en vez de aplicarla en silencio:

- **Por qué se justifica acá y no en general:** ADR-0004 evitó una estructura amplia especulativa ("quizás algún día necesitemos esto") sin evidencia. Acá la evidencia **ya existe** y es concreta, no hipotética: el roadmap de producto ya declara los dominios que van a escribir en este timeline (reproducción avanzada, genética, transferencia embrionaria, producción, IoT, IA, documentos, auditoría — todos en `docs/*.docx`). No es "por si acaso"; es "sabemos que viene, nombramos el lugar ahora para no migrar la estructura después".
- **Costo real de la excepción:** las carpetas vacías de Git no se versionan — se necesita un placeholder (`.gitkeep`) por carpeta para que el layout quede visible en el repo. Sin código dentro, no hay riesgo de que se llenen de abstracciones prematuras (`application/`, `domain/`, `infrastructure/` seguirán vacías hasta que un caso real las necesite — la política de "código real antes que carpeta poblada" se mantiene *dentro* de cada carpeta, solo el layout externo se declara antes).
- **Qué NO autoriza esta excepción:** no es licencia para crear estructura anticipada en otros módulos. Es una decisión puntual, para este bounded context, con esta justificación específica — cualquier otro caso similar necesita su propio ADR, no puede citar este como precedente genérico.

## Impacto arquitectónico

- `sync.service.ts` pierde la rama `animal_events` de `applyEvent()` — un módulo más fuera de la lógica de coordinación de sync, consistente con ADR-0008.
- Primer bounded context del codebase dedicado explícitamente a un **subdominio genérico** (no a un aggregate de negocio como herd/health/repro) — establece que ese patrón es válido en este proyecto para conceptos transversales con identidad propia, distinto del patrón `CommonModule` (rechazado) y del patrón `SyncRegistryModule`/`DbModule` (infraestructura pura, sin semántica de dominio).
- Prepara el terreno para que el futuro Event Bus (F5) tenga un suscriptor natural: `AnimalHistoryModule` es donde el "consumidor" del evento de dominio `AnimalEventRecorded` (o similar) viviría — **no se construye ahora**, solo se señala que la costura queda en el lugar correcto.

## Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Ciclo de dependencia al agregar el módulo nuevo | Por construcción: `AnimalHistoryModule` no importa módulos de dominio ni `SyncModule`; solo depende de `DbModule`/`SyncRegistryModule` (ambos `@Global()`, sin arista explícita necesaria). Se verifica con `madge` antes de dar por cerrado el cambio, igual que en F6.1 |
| Cambio de comportamiento al mover la lógica | Ninguna lógica cambia — es un `INSERT ... ON CONFLICT DO NOTHING` sin regla de negocio, copiado literal. Se verifica con comparación dirigida (mismo changeset antes/después), igual que F6.1 encontró el bug de `autoResolved` |
| Carpetas vacías interpretadas como "ya hay algo acá" por un futuro engineer | Placeholder `.gitkeep` + este mismo ADR documentando que están vacías a propósito, no por descuido |
| Que esta excepción se use como precedente para crear estructura vacía en otros módulos sin la misma justificación | Documentado explícitamente arriba: la excepción aplica a este bounded context por su evidencia concreta de roadmap, no es una licencia general |

## Confirmaciones antes de implementar

- **Sin ciclos de dependencia:** el grafo queda `AnimalHistoryModule → (DbModule, SyncRegistryModule global, sin arista explícita)`; ningún módulo de dominio importa `AnimalHistoryModule`. Se confirma con `madge --circular` tras implementar, no se asume.
- **Sin cambio de comportamiento:** mismo SQL, mismos defaults (`event_type ?? 'note'`, `source: 'manual'`, `payload` serializado igual). Se confirma con la misma comparación dirigida usada en F6.1 (mismo changeset, misma respuesta HTTP, misma fila persistida, antes vs. después).

## Consecuencias

- **Positivo:** ownership correcto desde el día uno para el concepto que más va a crecer transversalmente en el ERP; evita una migración estructural futura cuando genética/IoT/IA lleguen y necesiten escribir al timeline.
- **Costo:** un módulo más con tres carpetas vacías durante un tiempo indeterminado — aceptado explícitamente, con la excepción documentada arriba.
- **Explícitamente fuera de alcance:** consolidar `common/events.ts` en este módulo; las otras 5 tablas de la oleada 2; cualquier lógica de dominio dentro de `application/`/`domain/`/`infrastructure/` (se agregan cuando un caso real las necesite, no antes); integración con el Event Bus (F5).
