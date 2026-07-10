# 0008 — Ownership de SyncHandlers: el dominio los posee, sync coordina

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 6 (F6.1, revisión post-piloto)
- **Contexto relacionado:** [[0007-server-authority-derived-values]]; `docs/sprints/foundation-hardening-sprint.md` §F6; Regla Permanente 2 (una regla de negocio en un solo lugar)

## Contexto

F6.1 implementó el primer `SyncHandler` (`TreatmentSyncHandler`) y lo registró **dentro del propio módulo `sync`**, vía un token de DI (`SYNC_HANDLERS`) con un factory que enumeraba los handlers explícitamente. Funcionó y se verificó equivalencia, pero al revisarlo surgió un problema de ownership: si cada handler nuevo (animals, pregnancies, y a futuro genética, transferencia embrionaria, producción, inventarios, IoT) se registra **dentro** de `sync/`, el módulo `sync` termina acumulando el conocimiento de reglas de negocio de **todos** los bounded contexts del ERP — exactamente el God-object que F6 existe para desarmar, solo que reconstruido en un lugar distinto (un import list en vez de un switch).

Se investigó el codebase antes de diseñar, no se asumió nada:

- **Estructura de módulos:** monolito modular flat — `AppModule` importa 11 módulos (`HealthModule`, `HerdModule`, `ReproModule`, `SyncModule`, …), cada uno con `providers`/`controllers` propios, **sin `imports` cruzados entre módulos de negocio hoy**. El propio docstring de `AppModule` declara la intención: *"la comunicación entre módulos pasará por el bus de eventos interno"* — es decir, el acoplamiento módulo-a-módulo explícito no es el patrón que este proyecto quiere para comunicación de dominio.
- **Precedente directo ya existente:** `DbModule` (`apps/api/src/db/db.module.ts`) ya es `@Global()`, exportando `DbService` — **todos** los módulos de negocio (`health`, `herd`, `repro`, …) inyectan `DbService` sin listar `DbModule` en su `imports`. Esto no es una técnica nueva para este codebase; es cómo ya resuelve "infraestructura transversal que muchos módulos necesitan, sin acoplarlos entre sí".
- **Precedente de ciclo de vida:** `DbService` ya implementa `OnModuleInit` (bootstrap asíncrono). Usar el mismo hook para que un handler se auto-registre al arrancar no introduce un patrón ajeno al proyecto.

## Decisión

**Los `SyncHandler` pertenecen al módulo dueño del dominio que escriben**, no a `sync/`. `sync/` queda como infraestructura de coordinación pura: recibe el changeset, decide a qué tabla corresponde, y delega — sin conocer ninguna regla de negocio ni importar ningún módulo de dominio.

### Dónde vive cada pieza

```
apps/api/src/modules/sync/
  contracts/
    sync-handler.interface.ts   # interfaz SyncHandler + tipo SyncConflict — TS puro, cero import de Nest
    sync-table.ts               # tipo SyncTable (ya existía, F6.1)
  registry/
    sync-handler.registry.ts    # @Injectable SyncHandlerRegistry — Map<SyncTable, SyncHandler>
    sync-registry.module.ts     # @Global() — exporta SyncHandlerRegistry + SyncConflictWriter
  sync-conflict.writer.ts       # @Injectable SyncConflictWriter (ya existía, F6.1 — se mueve a registry/)
  sync.service.ts
  sync.controller.ts
  sync.module.ts                # SIN imports de módulos de dominio, sin cambios por esta decisión

apps/api/src/modules/health/
  sync/
    treatment-sync.handler.ts   # implementa SyncHandler + OnModuleInit
  health.module.ts              # agrega TreatmentSyncHandler a providers — NO importa SyncModule
```

### Cómo se registran los handlers sin acoplamiento

No se usa un token de DI con array de providers (lo que F6.1 sí usaba) — un handler nuevo no necesita que `sync.module.ts` sepa que existe. En cambio:

1. `SyncRegistryModule` es `@Global()` (mismo patrón que `DbModule`) y se importa **una sola vez**, en `AppModule`, junto a `DbModule`. Exporta `SyncHandlerRegistry` y `SyncConflictWriter` — disponibles en **cualquier** módulo sin que ese módulo liste `SyncRegistryModule` en su `imports`.
2. Cada handler concreto (`TreatmentSyncHandler`) implementa `OnModuleInit` e inyecta `SyncHandlerRegistry` directamente (clase concreta, sin token — hay un solo proveedor posible). En `onModuleInit()` llama `this.registry.register(this)`.
3. `HealthModule` solo necesita agregar `TreatmentSyncHandler` a sus `providers` — nada más. No importa `SyncModule` ni `SyncRegistryModule`.
4. `SyncService` (en `sync.module.ts`) inyecta `SyncHandlerRegistry` de la misma forma — disponible globalmente, sin que `sync.module.ts` liste nada de dominio.

**Orden de arranque:** no importa. NestJS construye todos los providers (inyectando sus dependencias) antes de llamar a `onModuleInit()` en cualquiera de ellos — cuando `TreatmentSyncHandler.onModuleInit()` corre, `this.registry` ya es la instancia singleton completa, sin importar en qué orden Nest recorra los módulos. `SyncHandlerRegistry.get()` solo se llama en tiempo de request (dentro de `push()`), muy después de que el arranque terminó.

### Por qué los SyncHandlers pertenecen al dominio, no a sync

Un `SyncHandler` no es infraestructura — contiene la whitelist de columnas escribibles, las reglas de negocio (conflicto de estado terminal, Server Authority, preñez concurrente) y el INSERT/UPDATE de una tabla que pertenece a un bounded context concreto. Es la misma regla que ya gobierna el resto del sprint (Regla Permanente 2, `docs/domain-language.md`): **la lógica de un dominio vive en el módulo de ese dominio**, no en un módulo de infraestructura que la reexporta. Si `TreatmentSyncHandler` viviera en `sync/`, la regla de Server Authority de retiro sanitario (F4.4) quedaría físicamente separada del resto de la lógica de sanidad (`health.service.ts`, `computeWithdrawal`) sin ninguna razón técnica — solo por el accidente de que llegó a través del canal de sync en vez del canal REST.

### Por qué sync no debe conocer los dominios

Dos razones, no una:

1. **Open/Closed a nivel de módulo, no solo de clase.** F6 ya resolvía Open/Closed a nivel de tabla (agregar una tabla = un handler nuevo, sin tocar el switch). Pero si ese handler nuevo se registra importando su módulo dentro de `sync.module.ts`, agregar un dominio nuevo (genética, feedlot, IoT) sigue forzando una edición de `sync/` — el problema no desapareció, solo cambió de forma (de switch a import list). La decisión de F6.1 (dueño registra, sync coordina) es la que realmente cierra Open/Closed a nivel de módulo.
2. **Evita ciclos de dependencia por construcción, no por disciplina.** Si `sync.module.ts` importara `HealthModule`, `HerdModule`, `ReproModule`, etc., y en el futuro alguno de esos módulos necesitara algo de `sync` (p. ej. disparar un pull manual, o consultar el estado de un dispositivo), se cerraría un ciclo. Con el registry global como única superficie compartida, el grafo de módulos es un DAG por diseño: los módulos de dominio apuntan a `SyncRegistryModule` (que no depende de nada), `sync.module.ts` también apunta a `SyncRegistryModule` — nunca hay una arista entre `sync` y un módulo de dominio en ningún sentido.

## Consecuencias

- **Positivo:** `sync/` permanece del tamaño de "protocolo de sync" indefinidamente — no crece con cada dominio nuevo. Cada regla de Server Authority queda co-ubicada con el resto de la lógica de su dominio (un ingeniero de sanidad nunca necesita abrir `sync/` para entender una regla de retiro). Sin riesgo de ciclo, verificado con `madge` tras cada cambio.
- **Preparado para crecer** hacia reproducción avanzada, genética, transferencia embrionaria, producción, inventarios, IoT: cada bounded context nuevo agrega su propio `<módulo>/sync/<x>-sync.handler.ts` + una línea en `providers` — cero ediciones a `sync/` y cero ediciones a otros módulos de dominio.
- **Costo:** un nivel más de indirección (auto-registro vs. lista explícita) — se mitiga con el chequeo de duplicados en `SyncHandlerRegistry.register()` (falla fuerte en el arranque, no en runtime) y con `madge`/tests como red de seguridad.
- **`@Global()` es el segundo uso en el codebase** (el primero es `DbModule`) — no es un patrón nuevo que este proyecto no haya visto, es la extensión del mismo patrón a un segundo caso genuinamente análogo.
- **Explícitamente fuera de alcance:** Event Bus (F5). Esta decisión es sobre **aplicar comandos offline dentro de una transacción** (`SyncHandler`); el Event Bus futuro es sobre **publicar eventos de dominio después de cambios confirmados** — responsabilidades distintas, no se anticipa ninguna integración entre ambos todavía (ver también el análisis F6 en `docs/sprints/foundation-hardening-sprint.md`, que ya cubrió esta distinción).
- **No se migran `animals`/`pregnancies`/las 6 tablas evento restantes en este cambio** — esta ADR resuelve dónde vive la infraestructura; la migración de más handlers sigue el plan de oleadas ya aprobado, ahora aterrizando en sus módulos dueños en vez de en `sync/`.
