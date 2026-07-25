# D4 · Clima y agrometeorología — completado

Suite D (Agricultura y tierra), módulo 4 del catálogo. Con esto **Fase 2 queda a dos módulos de
cerrar**: F3 (CRM) y G4 (facturación electrónica).

## Alcance: la capa agroclimática, no la flota de dispositivos

El catálogo marca D4 como Fase 2-3 y le asigna las entidades `devices` y `sensor_readings`. Lo que
se construyó es la parte de **Fase 2**: registrar mediciones y derivar índices que condicionan
decisiones de manejo.

Lo que NO se construyó, a propósito: aprovisionamiento de dispositivos, gateways, certificados y
telemetría a escala. Eso es **K1 · IoT y sensores (Fase 3)**. Para D4, una estación es una fuente de
datos con nombre — un `device` de categoría `environmental` —, y eso alcanza para que el módulo
sirva sin adelantar una fase.

## Decisiones

**Los índices se DERIVAN, no se materializan.** Las mediciones se guardan crudas (métrica, valor,
instante) y todo lo demás se calcula al consultarlo — mismo criterio que la GDP en P8. Si mañana se
corrige una lectura mal cargada, los cuatro indicadores se corrigen solos.

**Un día sin medición no es un día sin lluvia.** Los acumulados suman solo los días que midieron, y
el resumen informa `daysWithoutData`. Tratar el hueco como cero convertiría una estación con fallas
en una sequía inventada; el número y su confianza viajan juntos.

**`null` no es `0`.** `growingDegreeDays` devuelve `null` cuando no hubo temperatura, no 0: "no sé"
y "no hubo crecimiento" son cosas distintas y confundirlas arruina el acumulado. Lo mismo con el
balance hídrico sin ETP — asumirla en 0 daría un balance falsamente optimista justo en verano, que
es cuando se mira.

**La escala de estrés calórico depende del sistema productivo.** Una vaca lechera en producción
genera más calor metabólico y empieza a sufrir mucho antes que un novillo a campo: con una sola
escala, el tambo no vería una alerta hasta que ya hubiera caído la producción. Se usan los umbrales
de Armstrong (1994) para lechería y el Livestock Weather Safety Index para carne.

El sistema se **deriva** de si la finca tiene producción de leche cargada, en vez de configurarse:
el dato ya existe y no hay dónde guardar la preferencia sin agregar una columna. Para que no sea
magia escondida, la escala elegida viaja en la respuesta (`system`) y en el texto de la alerta
(«Escala de lechería…»).

**Las alertas de clima no tienen umbral configurable.** Se prenden y se apagan como cualquier regla,
pero el umbral no es una preferencia del productor: es una escala agronómica documentada. Lo que sí
varía por finca —lechería o carne— se resuelve por otro lado.

**`mild` no alerta.** Avisar todos los días de verano entrenaría al productor a ignorar el aviso. La
alerta arranca en `moderate` y escala a `critical` desde `severe`.

**La unidad vive en el código, no en `sensor_readings.unit`.** Esa columna tiene una FK contra el
catálogo canónico `units`, que no puede expresar humedad relativa (%) ni velocidad de viento (km/h):
sus dimensiones son masa, volumen, área, longitud, temperatura, tiempo, conteo y energía. Llenarla
solo para las métricas que encajan dejaría un dato a medias. La métrica determina la unidad sin
ambigüedad, así que la fuente única es el mapa `METRICS`.

## Bug transversal encontrado

**El motor de alertas silenciaba 14 días lo que él mismo auto-resolvía.** La ventana de silencio
existe para no recrear al toque algo que el productor ya despachó, pero no distinguía entre "el
usuario la resolvió" y "la condición dejó de darse". Para alertas de un animal casi no se nota; para
el clima es fatal: **el estrés calórico se termina cada noche**, así que el motor auto-resolvía la
alerta y a la ola de calor siguiente no avisaba nunca más dentro de los 14 días.

Corregido con la migración `0010_alerts_resolved_by`: se silencia solo lo que cerró una persona
(`resolved_by IS NOT NULL`). Afecta a **todas** las reglas, no solo a las de clima.

## Qué quedó

| Capa | Qué |
|---|---|
| Dominio (`packages/domain/src/weather/`) | GDD (con tope), THI, niveles de estrés por sistema, balance hídrico, heladas y el resumen del período — 31 tests |
| API (`modules/weather/`) | estaciones, ingesta validada por lote, serie diaria e indicadores — 16 tests de integración |
| Alertas | `heat_stress` y `frost` dentro del motor A5, categoría `iot` — 9 tests de integración |
| Web | `/clima`: los cuatro indicadores, parte del día y serie, detrás del flag `module_weather` |

**Endpoints:** `GET/POST /v1/weather/stations` · `POST /v1/weather/readings` ·
`GET /v1/weather/daily` · `GET /v1/weather/summary`.

## Verificación

1072 tests verdes. Además, de punta a punta sobre la app corriendo: se cargó una serie de 10 días
por el proxy de la web, la pantalla mostró **41 mm de lluvia, 132.5 °D, 19 mm de balance y estrés
máximo «Emergencia» (THI 90.7, escala de carne)** junto al aviso de que solo 10 de los 30 días
tenían mediciones; y al cargar una medición de calor para hoy, la alerta apareció en el feed como
`CRITICAL — Estrés calórico de emergencia (THI 93.7)`.

## Qué falta del módulo

- **Pronóstico**: el catálogo lo pide integrado al dashboard. Necesita una fuente externa
  (proveedor + clave), que es una decisión de producto, no de código.
- **Alerta de lluvia extrema**: el umbral en mm sí es una preferencia del productor y el mecanismo
  de reglas hoy solo guarda un parámetro llamado `days`. Reusarlo para milímetros dejaría un campo
  mintiendo en la API de configuración.
- **Ingesta automática**: hoy la carga es por API (una estación puede postear su tanda) o manual. El
  pull programado desde un proveedor es parte de K5 (Integraciones).
