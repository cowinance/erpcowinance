# Cowinance — Estrategia de Monetización

**Estado:** hipótesis (sin decidir). **Decisión:** el modelo definitivo saldrá de los **design
partners** y del valor percibido, no de una elección a priori. **No se construye billing hasta
comprobar adopción** (ver [design-partner-strategy.md](design-partner-strategy.md)).

---

## Principio

Cobrar antes de tener fincas usándolo mata la adopción. Primero validamos (3-5 pilotos gratis),
medimos disposición de pago y valor percibido, y **recién ahí** fijamos el modelo y construimos
facturación (P6 del roadmap). Este documento registra las **hipótesis**, no una decisión.

## Hipótesis de modelo (a validar)

### H1 — Por cantidad de animales (per-head)
- **Cómo:** precio por cabeza activa (o por tramo de cabezas).
- **A favor:** escala con el tamaño de la finca = escala con el valor recibido; el sistema ya conoce
  el conteo de animales activos (dato disponible).
- **En contra:** el productor puede percibirlo como "impuesto por cabeza"; incentiva a no cargar todo
  el hato.

### H2 — Por finca (per-farm / flat)
- **Cómo:** precio fijo por finca (o por organización), quizás con tramos por tamaño.
- **A favor:** simple de entender y presupuestar; no penaliza cargar más datos.
- **En contra:** una finca de 200 y una de 1500 pagan parecido = mal alineado con el valor.

### H3 — Planes escalonados (tiered)
- **Cómo:** planes (p. ej. Básico/Pro) por capacidades y/o límites (cabezas, usuarios, módulos).
- **A favor:** captura distinta disposición de pago; camino natural para vender capacidades de Fase 2
  (lechería, inventarios) como plan superior.
- **En contra:** requiere tener capacidades diferenciables entre planes (hoy el núcleo es uno solo).

### H4 — Freemium limitado
- **Cómo:** gratis hasta N cabezas / features básicas; pago al superar el límite.
- **A favor:** baja fricción de entrada, bueno para adquisición LatAm; el productor prueba con su hato
  real antes de pagar.
- **En contra:** riesgo de que el límite gratis alcance a fincas chicas y no conviertan; costo de
  servir usuarios gratis.

## Qué medir en el piloto para decidir

- **Disposición de pago** (conversación explícita) y **precio de referencia** que el productor
  consideraría justo.
- **Valor percibido** por proceso (¿qué le ahorra tiempo/dinero/riesgo?).
- **Correlación tamaño ↔ valor** (¿una finca más grande percibe proporcionalmente más valor? → apoya
  per-head/tiered).
- **Sensibilidad al modelo** (¿prefiere previsibilidad de un flat, o pagar por lo que usa?).

## Consideraciones técnicas (cuando se construya P6, no antes)

- **Medición de uso:** el conteo de cabezas activas ya existe; instrumentar "uso" más fino
  reutilizaría el Event Bus (F5).
- **Multi-usuario y RBAC:** los planes con múltiples usuarios por finca empujan la necesidad de RBAC
  real (hoy superficial — deuda registrada).
- **Pasarela de pago regional:** el cobro real en LatAm depende de una pasarela por país (infra
  externa) — decisión aparte del modelo.

## Estado

Ninguna hipótesis está elegida. La monetización es **explícitamente posterior** a validar adopción
con design partners. Este documento se actualiza con la evidencia del piloto.
