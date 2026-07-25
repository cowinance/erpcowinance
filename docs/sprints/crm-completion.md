# F3 · CRM — completado

Suite F (Comercial y CRM), módulo 3 del catálogo. **Fase 2 queda a un módulo de cerrar: G4 ·
facturación electrónica.**

## Qué agrega, y sobre qué

El maestro de terceros ya existía desde C-1 (`business_partners`, con compras y ventas encima). Lo
que faltaba era el **seguimiento**: con quién se habló, qué se acordó, qué está en curso y qué
contrato vence.

Vive **dentro del módulo `commerce`**, no en uno propio: comparte `business_partners` con Compras y
Ventas, y separarlo obligaría a que dos módulos escriban sobre la misma tabla maestra.

## Sobre las tablas

El catálogo asigna a F3 las entidades `business_partners`, `contacts` y `contracts` — las tres ya
estaban en el esquema canónico, dormidas. Pero describe además dos capacidades **sin tabla
asignada**: historial de interacciones y oportunidades. Esas se agregaron en la migración `0011`:

- `partner_interactions` — un HECHO inmutable, como los eventos del animal: se registra qué pasó, no
  se edita después. Por eso no tiene `updated_at` ni estado.
- `opportunities` + `opportunity_stage_events` — el pipeline y su historial.
- `business_partners.segment` — una columna, no una tabla: un socio tiene un segmento.

## Decisiones

**El pipeline se pondera por etapa.** Sin ponderar, diez charlas iniciales «valen» lo mismo que diez
contratos a punto de firmarse y el número deja de servir para decidir. Se usan las probabilidades
comerciales habituales (10/25/50/75 %) y el resumen informa **siempre el nominal al lado del
ponderado**: el peso no es una predicción y no debe disfrazarse de una.

**Una oportunidad sin monto no vale cero.** Mismo criterio que el clima: es una incógnita. Los
totales la excluyen y el resumen dice cuántas quedaron fuera de la suma.

**Lo cerrado no se reabre.** `won` y `lost` son terminales; una oportunidad ganada que «vuelve» es
otra oportunidad. Dejar mutar la etapa haría que el histórico de conversión mienta.

**Perder exige motivo.** Un pipeline que no registra por qué se cayeron las ventas no le enseña nada
al trimestre siguiente.

**Cada movimiento de etapa deja rastro** (`opportunity_stage_events`). Sin historial no se puede
responder cuánto tarda una oportunidad en cerrarse, porque la etapa actual pisa a la anterior.

**La vigencia del contrato se deriva de las fechas; el estado lo decide una persona.** Rescindir es
una decisión, vencer es el paso del tiempo. Mezclarlos obligaría a un job que «vence» contratos a
medianoche — y a que un contrato quede mal si ese job no corrió. Mismo criterio que `is_expired` en
certificaciones (T-2). `terminated` y `draft` ganan sobre cualquier cálculo de fechas.

**Un contacto solo se asocia a interacciones de SU socio.** Registrar una llamada al contacto de otro
cliente es un dato corrupto que después nadie encuentra.

## Qué quedó

| Capa | Qué |
|---|---|
| Dominio (`packages/domain/src/crm/`) | etapas y transiciones, pipeline ponderado, vigencia y resumen de contratos — 27 tests |
| API (`modules/commerce/crm.*`) | contactos, segmento, interacciones con seguimiento, oportunidades con historial, contratos y panel — 20 tests de integración |
| Web | `/comercial/crm`: los cuatro indicadores, embudo, alta y movimiento de oportunidades, registro de contactos y contratos |

**Endpoints:** `GET /v1/crm/summary` · contactos y segmento por socio · `GET/POST
/v1/crm/interactions` · `GET /v1/crm/follow-ups` · `GET/POST /v1/crm/opportunities` ·
`PATCH /v1/crm/opportunities/:id/stage` · `GET /v1/crm/opportunities/:id/history` ·
`GET/POST /v1/crm/contracts` · `PATCH /v1/crm/contracts/:id/status`.

## Dos errores que aparecieron al correrlo

**`inconsistent types deduced for parameter $2`.** El `UPDATE` de etapa usaba el mismo parámetro en
una asignación, un `IN` y una comparación; Postgres no puede deducir un tipo único. Se resolvió con
casts explícitos (`$2::text`).

**Fechas serializadas como marca de tiempo.** `next_action_at` llegaba a la pantalla como
`2026-07-27T00:00:00.000Z`: el driver devuelve las columnas `date` como `Date`. Además de verse mal,
invita a que el cliente le aplique una zona horaria y muestre el día anterior. Se castean a `::text`
— el mismo gotcha ya documentado en Pastoreo (PG-1).

## Verificación

1119 tests verdes. Y sobre la app corriendo: se cargaron tres oportunidades, dos interacciones y dos
contratos por el proxy de la web, y la pantalla mostró **2 clientes activos, 3 oportunidades
abiertas, 103.000 nominal / 39.100 ponderado, 1 contrato por vencer y 345.000 de cartera**, con el
embudo por etapa y el aviso de «1 sin valor cargado».

## Qué falta del módulo

- **Leads del Marketplace**: el catálogo pide la integración, pero C4 · Marketplace es Fase 4.
- **Conversión automática a venta**: hoy el enlace `opportunity → sale` se registra al cerrar y se
  valida que la venta sea del mismo socio, pero no se genera la venta desde la oportunidad. Crear el
  documento comercial desde acá duplicaría la regla que ya vive en `SalesService`.
