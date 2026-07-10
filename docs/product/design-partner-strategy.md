# Cowinance — Estrategia de Design Partners

**Estado:** vigente (inicio Fase Producto). **Premisa:** la próxima etapa de Cowinance no es solo
construir software, sino **validar el producto con operaciones ganaderas reales** antes de
comercializar.

---

## Objetivo

**3-5 fincas piloto** usando Cowinance de forma real (gratis) durante la etapa de validación. El
piloto define qué construimos después y si/cómo cobramos — no al revés.

## Por qué antes de monetizar

Construir billing, o features de la lista de specs, sin fincas reales usándolo, es adivinar. Los
design partners nos dan evidencia en vez de suposiciones: qué se usa, qué falta, qué genera valor, y
si pagarían. Es la misma disciplina del sprint técnico ("no crear abstracción sin consumidor real"),
aplicada al producto: **no construir capacidad sin necesidad demostrada.**

## Perfil del design partner ideal

- **Región:** Latinoamérica.
- **Tamaño:** ≈ 200-1500 animales.
- **Manejo:** profesional (ya lleva registros, aunque sea en Excel/papel).
- **Operación:** preferentemente **mixta** (leche + carne) para ejercitar el núcleo completo.
- **Actitud:** dispuesto a ser finca piloto y a dar feedback frecuente.
- **Dolor claro:** sistemas fragmentados/manuales que ya no le alcanzan.

Ver [personas.md](personas.md).

## Qué medimos (evidencia de adopción y valor)

| Señal | Qué indica | Cómo la obtenemos |
|---|---|---|
| **Frecuencia de uso** | Adopción real vs. prueba única | Actividad por usuario/finca (los eventos del Event Bus F5 son base natural para esto) |
| **Módulos utilizados** | Qué del núcleo genera valor | Qué endpoints/pantallas se usan |
| **Procesos que generan más valor** | Dónde enfocar producto | Feedback + observación de uso |
| **Problemas encontrados** | Fricción a resolver | Feedback + soporte |
| **Funcionalidades faltantes** | Roadmap dirigido por demanda real | Feedback |
| **Disposición futura de pago** | Base de la monetización | Conversación explícita con el productor |

> **Nota de instrumentación:** medir frecuencia/módulos requiere analítica de uso. Hoy **no existe**
> ese instrumento; es una capacidad a evaluar (mínima) cuando arranque el piloto — probablemente
> reutilizando el Event Bus (F5) como fuente de eventos de actividad. No se construye por adelantado.

## Cómo el piloto alimenta las decisiones

- **Producto:** las "funcionalidades faltantes" y los "procesos de más valor" reordenan P4-P6 y
  definen qué capacidad de Fase 2 se prioriza (¿lechería?, ¿inventarios?, ¿finanzas?).
- **Monetización:** la "disposición de pago" + el "valor percibido" deciden el modelo (ver
  [monetization-strategy.md](monetization-strategy.md)).
- **Localización:** qué país/terminología/normativa importa primero sale del piloto, no de la spec.

## Qué NO hacer durante el piloto

- No construir billing (P6) hasta comprobar adopción.
- No construir módulos nuevos de Fase 2 "porque están en la lista".
- No prometer features no construidas — el piloto usa lo que existe + P1-P3.

## Criterio de salida del piloto

Suficiente evidencia para responder, con datos: (1) ¿las fincas lo usan de forma sostenida?, (2)
¿qué capacidad adicional aporta más valor?, (3) ¿pagarían, y por qué modelo? Con eso se decide seguir
a P6 (billing) y qué capacidad de Fase 2 abrir.
