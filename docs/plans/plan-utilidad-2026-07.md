# Plan: de cuaderno de datos a herramienta de decisión

**Fecha:** 2026-07-25 · **Cerrado:** 2026-07-26 · **Estado: COMPLETO — fases 1 a 5** · **Origen:**
pedido del productor — *«que no sea solo meter datos sino que esos datos muestren información útil»*

> **Cómo leer este documento.** El cuerpo es el plan tal como se escribió antes de empezar; se deja
> intacto a propósito, incluidos los diagnósticos que después resultaron viejos, porque saber en qué
> se acertó y en qué no vale más que un plan retocado para que parezca correcto. Cada fase abre con
> lo que efectivamente se construyó, y al final está lo que se aprendió y lo que quedó abierto.
>
> El recorrido en números: **1.072 → 1.634 tests**, `audit:arch` OK en cada etapa.

---

## El diagnóstico en una línea

El ERP **captura muy bien y devuelve poco**. La prueba: de nueve conjuntos de datos clave, **ocho
los lee solamente el módulo que los escribe**.

| Dato | Lo consume |
|---|---|
| `lab_results` · `grazing_records` · `sensor_readings` · `carcass_records` · `milk_quality_tests` · `genetic_evaluations` · `certifications` · `movement_guides` | solo su propio módulo |
| `stock_levels` | inventario **y sanidad** ✅ |

No faltan módulos: **falta la capa del «y entonces qué»**. El motor de costos (que ya cruza cultivos,
alimento, combustible, maquinaria, leche, ventas, tratamientos, pesajes y jornales) demuestra que la
arquitectura aguanta.

---

## Dos riesgos que el plan resuelve por diseño

**1. Fatiga de alertas.** Un motor que «mira todo» puede ahogar al usuario. Cuarenta avisos al abrir
la app equivalen a cero avisos. Por eso la Fase 1 arranca definiendo **umbral y severidad como
decisión de producto**, y termina con una regla dura: *si una alerta no cambia lo que alguien va a
hacer hoy, no es una alerta — es un dato de reporte*.

**2. Performance.** `computeDesired()` ya es el camino caro del sistema; la auditoría de julio 2026
lo detectó y obligó a compartir la pasada entre agenda y KPIs (~112 ms → ~58 ms). Sumar siete
fuentes sin medir vuelve lento el inicio, que es la pantalla más abierta. **Cada fase que toque
alertas mide antes y después.**

---

## Decisiones a tomar ANTES de escribir código

Se resuelven una vez y evitan retrabajo en las cuatro fases:

1. **La lista completa de categorías de alerta.** Hoy `alert_rules.category` tiene un `CHECK` cerrado
   con `health, inventory, reproduction, iot, finance, task`. Las nuevas (genética, tambo,
   trazabilidad, fiscal, maquinaria) piden migración. **Decidir la lista entera y migrar UNA vez**,
   no de a una.
2. **Convención de confianza.** Todo número derivado de pocas observaciones (índice de un toro con 12
   terneros) debe mostrar **cuánta confianza merece**. Prometer precisión inexistente es peor que no
   mostrar el número. Definir el criterio una vez y aplicarlo en todo el plan.
3. **Dónde vive cada regla nueva.** Cálculo puro → `packages/domain`. Consulta → servicio. La regla
   permanente del proyecto: si dos canales la necesitan, va al dominio.

---

## FASE 1 · El motor de alertas mira todo — ✅ COMPLETA

> **Hecho.** 7 reglas nuevas (stock bajo, factura vencida, serie fiscal, laboratorio, recuento
> celular, mantenimiento, certificación), categorías migradas de una vez, agrupación de alertas que
> son un solo trabajo (`group_key`) y `batch_key` en tareas.
>
> **Lo que destapó:** el motor silenciaba 14 días lo que él mismo auto-resolvía. Un bug transversal
> que ninguna regla nueva habría encontrado.

**Por qué primero:** reutiliza lo más caro ya construido (reconciliador, reglas configurables,
ledger, notificaciones, feed, agenda, integración con tareas y manga). Conectar una fuente nueva es
**agregar un caso a `computeDesired`**, no construir un módulo. Toca siete módulos de una sola vez.

Recordatorio de cómo funciona: no es una lista guardada, es un **reconciliador**. Calcula qué
alertas *deberían* existir, compara con las que hay, crea y resuelve la diferencia. Por eso se
apagan solas. Las reglas son datos (`{code, days}`), configurables sin deploy.

| Etapa | Qué | Fuente |
|---|---|---|
| **1.0** | Categorías + migración única del `CHECK`; criterio de severidad y umbrales por defecto | — |
| **1.1** | Stock bajo mínimo · factura vencida · **serie fiscal por agotarse** | `stock_levels`, `invoices`, `fiscal_series` |
| **1.2** | Resultado de laboratorio crítico · recuento celular alto | `lab_results`, `milk_quality_tests` |
| **1.3** | Mantenimiento por horas/km · certificación por vencer | `maintenance_records`, `certifications` |
| **1.4** | Reglas configurables de todas las nuevas en `/configuracion` + medición de performance | — |

**Nota:** `fiscal_series` ya calcula `low`/`exhausted` (G4-2) y **nadie escucha**. Quedarse sin formas
libres es no poder facturar hasta que la imprenta entregue. Es la más barata de todas.

`alert_rules` ya tiene las categorías `inventory` y `finance` **sin usar**: están esperando.

**Verificación:** por cada fuente, un test que la alerta aparezca cuando corresponde **y se resuelva
sola** cuando el problema deja de existir. Más medición del tiempo de `/dashboard/home` antes y
después de cada etapa.

---

## FASE 2 · Genética: de la pajuela al kilo — ✅ COMPLETA

> **Hecho.** Ajuste a 205 días, grupo contemporáneo con índice y confianza, evaluación por toro,
> rendimiento en la res y costo por kilo destetado. Pantalla `/genetica/desempeno`.
>
> **Lo que enseña la pantalla:** en el demo el ranking por índice sale INVERTIDO al ranking por
> costo — el mejor toro al destete (109) es el más caro por kilo. Ésa es la tensión que el módulo
> existe para mostrar.

**Por qué segundo:** es donde más se nota la diferencia entre cuaderno y herramienta, porque responde
la única pregunta de plata que hoy no tiene respuesta: **¿qué semen vuelvo a comprar?**

**La cadena YA EXISTE completa en el esquema.** No es un problema de modelo de datos, es que nadie
escribió la consulta:

```
semen_batches (sire_id, batch_code, breed_id, supplier_id)
  └→ breeding_events (dam, sire_id, semen_batch_id)
      └→ pregnancies → calvings → calving_offspring (birth_weight_kg)
          └→ animals (sire_id, dam_id)
              ├→ weanings (weaning_weight_kg)
              ├→ v_weighings (GDP)
              └→ carcass_records (rendimiento, ya guarda sire_id)
```

Hoy Genética es un **depósito**: sus consultas solo tocan termos, canastas, pajuelas, embriones y
evaluaciones. **Nunca se une con el desempeño de los animales.**

| Etapa | Qué | Dónde |
|---|---|---|
| **2.1** | **Ajuste a 205 días** (edad del ternero, sexo, edad de la madre) | `packages/domain` — puro |
| **2.2** | **Grupo contemporáneo** + índice (100 = promedio del grupo) + confianza por N | `packages/domain` |
| **2.3** | Evaluación por toro: concepción → nacimiento → destete ajustado → GDP posdestete | servicio genetics |
| **2.4** | Cerrar con faena: rendimiento de res por toro | + `carcass_records` |
| **2.5** | **Costo por kilo destetado** (precio de pajuela × tasa de preñez) + pantalla | servicio + web |

**El punto metodológico que separa esto de un promedio ingenuo:** no se pueden comparar pesos al
destete crudos. Un ternero pesa más por nacer antes, ser macho, o tener madre adulta — nada de eso
es genética. Ajustar a 205 días y comparar **dentro del grupo contemporáneo** (mismo lote, misma
parición, mismo manejo) es lo que hace que el número compare genética y no circunstancia.

**Verificación:** casos construidos a mano con el ajuste calculado aparte; y el índice del grupo debe
promediar 100 por construcción — es una invariante que el test puede exigir.

---

## FASE 3 · Los lazos que faltan — ✅ COMPLETA

> **Hecho, los cuatro.** 3.1 laboratorio → caso clínico (solo con diagnóstico; fuera de rango sin
> diagnóstico queda a un clic, para no llenar Sanidad de casos que nadie cierra). 3.2 rendimiento de
> potrero con el clima de SUS ventanas. 3.3 la venta avisa de la certificación sin bloquear nunca.
> 3.4 en qué se va la mano de obra, por tipo de trabajo.
>
> **Quedó afuera a propósito:** el aviso de guía de traslado. `movement_guides` no tiene enlace a la
> venta ni detalle por animal — necesita migración y una forma de emitirla desde la venta. Media
> función habría avisado de algo que no se puede resolver desde donde se avisa.

Cada uno rompe un silo concreto. Independientes entre sí: se pueden reordenar según lo que duela.

| Etapa | Lazo | Por qué importa |
|---|---|---|
| **3.1** | **Laboratorio → Sanidad**: un resultado positivo abre caso clínico con el animal cargado | El más urgente: es salud animal, y hoy depende de que alguien lea y se acuerde |
| **3.2** | **Pastoreo + Clima → rendimiento de potrero**: ocupación y balance hídrico cruzados con ganancia de peso del lote | Decide la rotación del año siguiente |
| **3.3** | **Trazabilidad → Comercial**: la venta avisa si falta certificación vigente, ANTES de cerrarla | Hoy se descubre cuando frena la venta |
| **3.4** | **RRHH → costo laboral por actividad** (`work_logs` ya lo tiene, Costos ya lo lee) | Dice si conviene contratar o tercerizar |

---

## FASE 4 · Dar salida a los que solo capturan — ✅ COMPLETA (3 de 4; el cuarto ya estaba)

> **El diagnóstico de Lotes de esta tabla estaba VIEJO.** Se escribió antes de la mejora B1, que ya
> había entregado listado, detalle, historial y métricas por propósito. Se verificaron los cuatro
> módulos antes de elegir en vez de creerle al plan, y no se reconstruyó lo que ya existía.
>
> **Hecho:** Maquinaria (costo por hora o por km, con el correctivo separado del preventivo),
> Inventario (cobertura en días y punto de reposición DERIVADO del consumo), Agricultura (rinde por
> hectárea derivado, índice contra el mismo cultivo, margen solo con precio de venta real).

| Módulo | Estado | Qué falta |
|---|---|---|
| **Lotes** | 9 endpoints de escritura, **1 de lectura** — el más desbalanceado del ERP | métricas del lote, comparativa, evolución |
| **Inventario** | kardex completo | rotación, obsoletos, punto de reposición |
| **Maquinaria** | horas, combustible, mantenimiento | costo por hora, comparativa entre máquinas |
| **Agricultura** | labores, cosechas | rinde por hectárea comparado, margen por cultivo |

---

## FASE 5 · Reportes al día con el ERP — ✅ COMPLETA

> **Hecho:** `GET /reports/farm-summary` + pestaña «Resumen de la finca», con diez bloques
> (hacienda, producción, reproducción, sanidad, economía, mano de obra, inventario, maquinaria,
> agricultura, pastoreo).
>
> **Ensamblado, como el plan pedía:** cada bloque llama al servicio dueño de ese número en vez de
> rehacer su consulta, y hay un test que compara margen y plata quieta contra sus módulos. Si el
> resumen tuviera SQL propio, el día que cambie una regla habría dos verdades y la del resumen —la
> pantalla más mirada— ganaría por costumbre.

Reportes solo lee animales, sanidad y reproducción: **no refleja ninguno de los 20 verticales
construidos después**. Va último a propósito — cuando las fases 1 a 4 terminen, Reportes es
ensamblado, no invención.

---

## Lo que este plan NO hace

Dicho explícitamente para que nadie lo dé por incluido:

- **No rediseña la app móvil nativa.** Es un pedido aparte, ya anotado y diferido.
- **No agrega módulos nuevos del catálogo.** Los 9 pendientes son Fase 3-4 del roadmap (IA, IoT,
  gemelo digital, marketplace…) y no entran acá.
- **No toca la configuración del servidor**, que sigue siendo lo único que puede perder datos reales.
- **No promete predicciones.** Todo lo de este plan es descriptivo: cruza datos que ya existen. Nada
  de modelos ni estimaciones.

---

## Orden y criterio

1. **Fase 1** primero por palanca: máximo alcance sobre lo ya construido.
2. **Fase 2** después por valor: la pregunta de plata sin responder.
3. **Fases 3 y 4** son independientes entre sí — se reordenan según lo que moleste en el uso diario.
4. **Fase 5** al final, cuando haya qué ensamblar.

**Regla de trabajo del proyecto, que se mantiene:** una etapa por vez, verificada corriendo la app,
y proponer los próximos pasos antes de seguir. Nada de fases enteras sin revisar.

---

## Lo que se aprendió construyéndolo

Anotado porque son cosas que se repiten y cuesta caro volver a descubrirlas.

### 1. `Number(null)` es `0`, y `0` es una afirmación

Apareció **tres veces** en la misma fase, dos en TypeScript y una en SQL:

- balance hídrico sin pluviómetro → se leía «normal», y el aviso que evita condenar a un potrero por
  la seca no aparecía nunca;
- costo de un ítem sin cargar → el stock valía `0`, y el total de plata quieta salía más bajo que la
  realidad;
- `COALESCE(avg_cost, 0)` en el promedio ponderado → lo mismo, en la consulta.

El patrón: **un cero es una afirmación** («no llovió», «no vale nada»), un `null` es una ausencia.
Convertir lo segundo en lo primero produce números que no se ven rotos. En los tres casos lo cazó un
test escrito para eso, no la revisión.

### 2. El demo que no se parece a producción esconde o inventa problemas

Pasó tantas veces que dejó de ser anécdota: alertas agrupadas que en la demo no agrupaban, títulos
de tarea sin caravana, la cadena genética vacía, rendimientos de res imposibles, **todos los toros
con 100% de concepción** porque el seed solo cargaba los servicios que habían preñado. Desde la
etapa 2.3, **el seed viaja en el mismo commit que la feature** y se siembran las ramas que cambian
la conclusión, no una sola feliz.

### 3. Un aviso que aparece siempre no dice nada

Tres veces hubo que subir un umbral porque el aviso salía en casi todas las filas: estrés calórico
(pasó a proporción, ≥50% de los días), cobertura de mano de obra (80%), y el margen sospechoso del
resumen —cuyo primer corte, «ingresos < 10% del costo», **dejaba pasar un margen de −717%**, que era
exactamente el caso para el que se había escrito—. La regla que quedó: si el aviso no distingue una
fila de las otras, o no aparece cuando más falta, es decoración.

### 4. Lo derivado NO se lee de la columna guardada

`carcass_records` y `harvests.yield_per_ha` guardan valores que alguien escribió una vez y que pueden
haber quedado distintos de los datos que tienen al lado. En los dos casos se deriva del hecho
(peso vivo real, cosecha ÷ superficie) y la columna se ignora. Dos verdades sobre el mismo número es
peor que una sola incómoda.

### 5. Un test que se rompe porque el demo creció estaba sobreajustado

Enriquecer el seed rompió las suites de clima (afirmaban sobre una base vacía) y la de ventas. No se
bajaron expectativas: las suites de clima pasaron a ser **dueñas de su fixture**. La de ventas
destapó un problema real y se dejó **a la vista**, no tapado (ver abajo).

---

## Lo que quedó abierto

| Qué | Por qué importa | Estado |
|---|---|---|
| **Configuración del servidor** — S3, rotar claves expuestas, `NEXT_PUBLIC_API_URL` local + rebuild | **Lo único que puede perder datos reales**: hoy las fotos se pierden en cada deploy | Pendiente, fuera del alcance de este plan |
| **Depósito con saldo al entregar una venta** | `SalesService.deliver` descuenta del depósito MÁS VIEJO del tenant, no de uno con saldo. Con más de un galpón, una venta puede fallar con «sin saldo» aunque el stock exista. Estaba latente porque el demo no tenía depósitos | Detectado acá; se dejó la limitación intacta porque cambiar la selección es una decisión de producto, no un arreglo de test |
| **Aviso de guía de traslado en la venta** | Es probablemente lo que más frena una entrega real | Diferido: necesita migración (`movement_guides` sin enlace a venta) + UI para emitirla |
| **Rediseño de la app móvil nativa** | Pedido del productor: «más robusta, más trabajada» | Diferido explícitamente por el productor |
| **RLS en el pipeline de despliegue** (paso 2.2 de la auditoría) | Sigue abierto de antes de este plan | Pendiente |

---

## Lo que este plan cumplió

El diagnóstico de arranque decía que **ocho de nueve conjuntos de datos clave los leía solamente el
módulo que los escribe**. Al cerrar:

| Dato | Ahora lo consume además |
|---|---|
| `lab_results` | Sanidad (abre el caso clínico) |
| `grazing_records` | Rendimiento de potrero, cruzado con clima y pesajes |
| `sensor_readings` | Pastoreo (el clima de cada ventana) |
| `carcass_records` | Genética (rendimiento por toro) |
| `genetic_evaluations` | Evaluación por toro y costo por kilo destetado |
| `certifications` | Comercial (la venta avisa antes de cerrarse) |
| `work_logs` | Costos, por tipo de trabajo |
| `movement_guides` | **Sigue solo** — es lo único del diagnóstico que queda en pie |
