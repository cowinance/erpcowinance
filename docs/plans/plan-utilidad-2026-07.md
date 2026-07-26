# Plan: de cuaderno de datos a herramienta de decisión

**Fecha:** 2026-07-25 · **Estado:** propuesto, sin arrancar · **Origen:** pedido del productor —
*«que no sea solo meter datos sino que esos datos muestren información útil»*

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

## FASE 1 · El motor de alertas mira todo

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

## FASE 2 · Genética: de la pajuela al kilo

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

## FASE 3 · Los lazos que faltan

Cada uno rompe un silo concreto. Independientes entre sí: se pueden reordenar según lo que duela.

| Etapa | Lazo | Por qué importa |
|---|---|---|
| **3.1** | **Laboratorio → Sanidad**: un resultado positivo abre caso clínico con el animal cargado | El más urgente: es salud animal, y hoy depende de que alguien lea y se acuerde |
| **3.2** | **Pastoreo + Clima → rendimiento de potrero**: ocupación y balance hídrico cruzados con ganancia de peso del lote | Decide la rotación del año siguiente |
| **3.3** | **Trazabilidad → Comercial**: la venta avisa si falta certificación vigente, ANTES de cerrarla | Hoy se descubre cuando frena la venta |
| **3.4** | **RRHH → costo laboral por actividad** (`work_logs` ya lo tiene, Costos ya lo lee) | Dice si conviene contratar o tercerizar |

---

## FASE 4 · Dar salida a los que solo capturan

| Módulo | Estado | Qué falta |
|---|---|---|
| **Lotes** | 9 endpoints de escritura, **1 de lectura** — el más desbalanceado del ERP | métricas del lote, comparativa, evolución |
| **Inventario** | kardex completo | rotación, obsoletos, punto de reposición |
| **Maquinaria** | horas, combustible, mantenimiento | costo por hora, comparativa entre máquinas |
| **Agricultura** | labores, cosechas | rinde por hectárea comparado, margen por cultivo |

---

## FASE 5 · Reportes al día con el ERP

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
