# 0006 — Estrategia de Value Objects: invariante real antes que patrón DDD

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 2 (F2.4)
- **Contexto relacionado:** [[0004-domain-package]]; Regla Permanente 5; `docs/domain-language.md`

## Contexto

F2.1 y F2.2 introdujeron Value Objects de identidad y `TagNumber` sin sobresaltos. Al llegar a
F2.4 (`Breed`, `Sex`, planificados juntos desde el diseño original del sprint), se detectó el
riesgo de construir un Value Object **porque el catálogo de VOs lo pedía**, no porque el concepto
lo necesitara — exactamente lo que la Regla Permanente 5 prohíbe ("un VO solo existe si aporta
al menos una garantía").

Se introdujo un checklist obligatorio de 5 preguntas para cada VO candidato, a responder **antes**
de escribir código:

1. Qué invariante protege.
2. Qué errores evita respecto a usar un tipo primitivo.
3. Qué comportamiento propio encapsula.
4. En qué módulos del ERP será reutilizado.
5. Por qué merece existir como Value Object y no simplemente como un `string`/`number`.

Aplicado a los dos candidatos de F2.4, dio resultados opuestos:

- **`Sex`**: conjunto cerrado `{F, M}` validado hoy de forma fragmentada (CHECK de Postgres +
  uniones de TypeScript sueltas y repetidas + formularios sin validar en el borde);
  comportamiento propio real (`isFemale`/`isMale`, lenguaje ubicuo del dominio). **Cumple las 5.**
- **`Breed`**: al revisar el schema y los consumidores actuales, `breed_id` **ya no es un
  primitivo disperso**. Existe la entidad de catálogo `breeds` (id UUID, `tenant_id` nullable =
  global vs. local del tenant, `species_id`, `code`, `name`, soft delete) y la relación N:M
  `animal_breeds(animal_id, breed_id, fraction)` para composición racial. Todo consumidor actual
  ya accede vía JOIN a la entidad real. No hay primitivo inseguro que envolver, ni comportamiento
  propio de "una raza" en el código. El único invariante identificado — la suma de fracciones
  raciales de un animal debe ser 1 (100%) — es un invariante **agregado** sobre la colección
  `animal_breeds` de un animal, no de un valor individual: no se puede expresar en un VO que
  envuelve un solo `breed_id`.

## Decisión

**Un Value Object solo se implementa cuando el checklist de 5 preguntas tiene respuesta real para
cada punto.** En particular:

- **No se crea un Value Object cuando una entidad o catálogo existente ya representa
  correctamente el concepto** (tiene identidad propia, ciclo de vida, o relaciones) **y no existe
  un invariante adicional que proteger** más allá de lo que la entidad y sus foreign keys ya
  garantizan.
- Si el invariante real es **agregado** (sobre una colección, no sobre un valor único), no
  pertenece a un Value Object del elemento individual. Se difiere a un servicio de dominio o a una
  futura abstracción de agregado, y **solo se construye cuando exista un consumidor concreto**
  (YAGNI) — no de forma anticipada.

Aplicación concreta en F2.4:

| Candidato | Decisión | Justificación |
|---|---|---|
| `Sex` | ✅ Value Object | Cumple las 5 preguntas del checklist (ver Contexto) |
| `Breed` | ❌ No es Value Object | Ya modelado como entidad de catálogo (`breeds` + `animal_breeds`); el invariante real (suma de fracciones = 1) es agregado y no tiene consumidor hoy — candidato futuro de servicio de dominio, no de VO |

El checklist de 5 preguntas queda **obligatorio** para todo Value Object nuevo, en lo que resta
del Foundation Hardening Sprint y en adelante.

## Consecuencias

- **Positivo:** evita Value Objects "decorativos" que envuelven una entidad ya bien modelada;
  mantiene la Regla Permanente 5 verificable con un criterio explícito y repetible; deja
  documentado por qué `Breed` no tiene VO (evita que una futura sesión lo re-proponga sin
  releer el análisis).
- **Costo:** cada VO candidato requiere un documento de diseño corto antes de implementarse
  (overhead pequeño, pagado una vez por VO).
- **Explícitamente fuera de alcance:** modelar la composición racial (`animal_breeds`, suma de
  fracciones) como agregado de dominio — se evalúa cuando exista una necesidad concreta de
  validarla (p. ej. al construir alta de composición racial en UI, o en F4).

## Extensión (F3) — el mismo criterio aplica a Domain Errors

F3 (Domain Errors + `DomainExceptionFilter`) partía de un catálogo propuesto de antemano:
`DuplicateTag`, `InvalidPregnancy`, `AnimalAlreadyExists`, `TreatmentExpired`, `InvalidMovement`.
Antes de implementarlo, se aplicó el mismo principio de esta ADR — generalizado a **toda**
abstracción de dominio, no solo Value Objects — con un criterio adaptado a errores:

1. Qué regla de dominio representa (¿la reconoce un usuario, o es un detalle técnico?).
2. Qué decisión distinta permite tomar al consumidor (UI, recuperación, auditoría).
3. Por qué un error genérico no alcanza.
4. Qué capa debe conocerlo (dominio / application / infraestructura).
5. Qué estabilidad tiene como contrato interno (evitar explosión de tipos).

Un inventario completo de los ~65 códigos de error de `apps/api` mostró que **ninguno de los 5
candidatos originales tiene hoy una función pura de dominio que lo necesite**: todos requieren
leer estado externo (existencia previa del animal, diagnóstico reproductivo abierto, catálogos) —
exactamente el mismo problema que tenía `Breed` como VO. Se diferieron los 5, sin excepción.

**Regla general que queda fijada** (no solo para VOs): **no se crea una abstracción de dominio
nueva sin demostrar antes qué problema real resuelve y por qué las abstracciones existentes no
alcanzan.** Para Domain Errors específicamente: no se crea un error de dominio sin que exista ya
una función pura de dominio (o un caso de uso concreto) que lo necesite lanzar.

F3 sí implementó `DomainExceptionFilter` (la plomería que traduce `DomainError` → HTTP), porque
eso **sí** tiene necesidad concreta hoy: los 4 `DomainError` de F2 (`InvalidIdentifier`,
`InvalidTagNumber`, `InvalidWeight`, `InvalidSex`) necesitan poder atravesar la capa HTTP sin
romper el contrato cuando se migren consumidores en F4.
