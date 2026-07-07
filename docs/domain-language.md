# Lenguaje ubicuo del dominio — Cowinance

Este documento define el **lenguaje compartido** del negocio ganadero de Cowinance.
Es la fuente única de significado: código, base de datos, API, UI y conversaciones con
expertos de dominio deben usar estos términos con **esta** definición. Si un concepto no
está acá, se agrega acá antes de nombrarlo en el código.

> Alcance F2: los términos marcados con ⬦ ya tienen (o tendrán en este sprint) un
> **Value Object** que garantiza sus reglas. El resto son parte del lenguaje y se
> formalizarán cuando su bounded context lo requiera.

## Convenciones

- **Idioma:** el negocio se habla en español; el código usa el término inglés entre paréntesis
  como identificador estable (`Animal`, `Farm`). Ambos son el mismo concepto.
- **Sinónimos regionales:** el vocabulario ganadero varía por país. El sistema respeta el
  término local del usuario en la UI, pero internamente el concepto es uno solo.
- **Identidad:** toda entidad se identifica con un UUID; en producción se recomienda UUID v7
  (ordenable en el tiempo). Todo dato operativo pertenece a un **Tenant** (aislamiento estricto).

---

## 1. Identidad y estructura organizativa

### Tenant ⬦ (Organización)
El **cliente lógico aislado** de la plataforma: el grupo económico o productor que contrata
Cowinance. Es la raíz del aislamiento de datos — ningún dato cruza entre tenants (garantizado
por Row-Level Security). En el modelo, la Organización es el tenant.
- **Identidad:** `TenantId` (UUID).
- **Regla/garantía:** todo registro operativo lleva su `tenant_id`; sin contexto de tenant, no hay acceso.
- **Relaciones:** un Tenant contiene una o más Empresas y Fincas; un usuario puede pertenecer a varios tenants.

### Company (Empresa)
La **entidad legal** dentro del grupo: tiene moneda funcional, régimen fiscal y plan de cuentas
propios. Nivel donde ocurre la contabilidad y la consolidación.
- **Relaciones:** pertenece a un Tenant; agrupa Fincas.

### Farm ⬦ (Finca / Establecimiento)
La **unidad operativa georreferenciada**: el campo físico donde vive el ganado, con código
oficial ante la autoridad sanitaria (RENSPA, etc.). Es el contexto por defecto de la captura de campo.
- **Identidad:** `FarmId` (UUID).
- **Relaciones:** pertenece a una Empresa; contiene Potreros y Lotes; los Animales viven en una Finca.
- **Sinónimos:** establecimiento, campo, predio, hacienda, estancia.

### Lot ⬦ (Lote / Rodeo)
Un **grupo de manejo** de animales que se tratan como una unidad (mismo destino, misma dieta,
mismo ciclo): rodeo de cría, tropa de engorde, grupo de recría. Es lógico, no geográfico: un
lote ocupa un Potrero pero puede moverse entre ellos.
- **Identidad:** `LotId` (UUID).
- **Regla/garantía:** un animal activo pertenece a lo sumo a un lote a la vez.
- **Relaciones:** pertenece a una Finca; ocupa un Potrero; agrupa Animales.
- **Sinónimos:** rodeo, tropa, majada (ovinos), lote.

### Paddock (Potrero)
La **subdivisión física** de la finca: un polígono georreferenciado con tipo de pastura y
capacidad de carga. Los lotes rotan entre potreros (pastoreo rotativo).
- **Relaciones:** pertenece a una Finca; lo ocupan Lotes/Animales.
- **Sinónimos:** potrero, piquete, cuadro, parcela.

### Movement (Movimiento)
El **hecho** de trasladar un animal o lote entre potreros, lotes o fincas, en una fecha. Es
inmutable y queda en la línea de tiempo del animal (trazabilidad de ubicación).
- **Regla/garantía:** un movimiento registra origen y destino; no se edita, se agrega otro.

---

## 2. Animal e identificación

### Animal ⬦
El **individuo** — el core del negocio. Un ser vivo con ciclo de vida (nacimiento → bajas por
venta/muerte/descarte), genealogía, y un historial completo de hechos. Multi-especie (bovino,
ovino, caprino, equino, porcino, búfalo).
- **Identidad:** `AnimalId` (UUID) — interna y estable, nunca cambia. Distinta de la caravana.
- **Regla/garantía:** el cambio de estado (activo→vendido/muerto) ocurre por **eventos**, no por
  borrado; el historial se conserva siempre (prohibido el hard-delete del individuo).
- **Relaciones:** vive en una Finca, pertenece a un Lote y ocupa un Potrero; tiene Identificadores,
  Razas (con %), una Categoría, un Sexo, madre y padre (genealogía).

### TagNumber ⬦ (Caravana)
El **identificador visible** que el productor lee en el campo (número en la caravana plástica).
Es el que se usa en la manga y en las búsquedas. **No es la identidad interna**: un animal puede
cambiar de caravana en el tiempo, y la misma caravana puede reasignarse tras una baja.
- **Regla/garantía:** entre los animales **activos** de un tenant, una caravana visual identifica a
  uno solo (no hay dos activos con la misma). Se normaliza (sin espacios sobrantes) al capturarla.
- **Sinónimos:** caravana (AR/UY), arete (MX), chapeta (CO), crotal (ES).

### AnimalIdentifier (Identificador)
La entidad general que vincula un Animal con **cualquier** identificador a lo largo del tiempo:
visual (caravana), RFID/EID (ISO 11784/85), bolus, tatuaje, marca, biométrico, oficial.
- **Regla/garantía:** un animal tiene N identificadores con vigencia; el mismo tipo+valor activo es único.

### Species (Especie)
El tipo biológico (bovino, ovino, …). Define la gestación estándar y las categorías posibles.

### Breed ⬦ (Raza)
La **raza** del animal (Angus, Hereford, Brangus…). Un animal puede ser mestizo: varias razas con
un **porcentaje** que suma 100% (composición racial).
- **Regla/garantía:** las fracciones raciales de un animal suman 1 (100%).
- **Relaciones:** una raza pertenece a una especie; puede ser global o propia del tenant (razas locales).

### Category (Categoría zootécnica)
La **clase productiva** derivada de especie + sexo + edad: vaca, toro, novillo, vaquillona,
ternero, ternera. Cambia con el tiempo (un ternero pasa a novillo). Determina el manejo.
- **Regla/garantía:** la categoría es coherente con el sexo y el rango de edad definido para ella.

### Sex ⬦ (Sexo)
El sexo del animal: **Hembra (F)** o **Macho (M)**. Simple pero transversal: condiciona categoría,
reproducción y manejo.
- **Regla/garantía:** valor cerrado {F, M}; ciertas operaciones (celo, servicio, preñez, parto)
  solo aplican a hembras.

---

## 3. Mediciones y desempeño

### Weight ⬦ (Peso)
La **masa** del animal en un momento, medida por báscula, cinta o estimación por imagen. Se
**almacena siempre en unidad SI (kilogramos)**; la presentación convierte (kg/lb) según el tenant.
- **Regla/garantía:** un peso es un número **positivo** con una unidad explícita; sin unidad no es un peso.
- **Relaciones:** se registra como Pesaje (hecho) del animal; alimenta el GDP y la curva de crecimiento.

### Weighing (Pesaje)
El **hecho** inmutable de haber pesado a un animal en una fecha, con método y opcional condición corporal.

### ADG / GDP (Ganancia diaria de peso)
La **tasa** de aumento de peso entre dos pesajes: (peso₂ − peso₁) / días. Indicador central de
desempeño productivo. Se deriva, no se captura.

### BodyCondition (Condición corporal)
Escala subjetiva (1–5) del estado de gordura/reservas del animal, tomada junto al pesaje.

---

## 4. Sanidad (health)

- **VeterinaryProduct (Medicamento):** producto del vademécum — vacuna, antibiótico, antiparasitario,
  vitamina, hormonal. Define los **períodos de retiro** en carne (días) y leche (horas).
- **Vaccination (Vacunación) / Treatment (Tratamiento):** hechos de aplicación de un producto a un
  animal, con dosis, vía y lote del frasco.
- **WithdrawalPeriod (Retiro):** ventana durante la cual, tras un tratamiento, el animal **no es apto**
  para faena (carne) u ordeñe (leche). Regla de inocuidad: se **calcula desde el producto** (fecha de
  aplicación + días/horas de retiro). Fuente de verdad: el servidor.
- **HealthPlan (Plan sanitario):** calendario reutilizable de pasos (producto + categorías + día
  relativo) que, al aplicarse a un lote/categoría, genera **Tareas** programadas → recordatorios.
- **Mortality (Mortalidad):** hecho de muerte de un animal, con causa; da de baja al individuo.

## 5. Reproducción (reproduction)

- **Heat (Celo):** hecho de detección de celo en una hembra.
- **Service (Servicio):** monta natural, inseminación artificial (IA) o transferencia embrionaria.
- **Pregnancy (Preñez):** estado de gestación abierto tras un diagnóstico positivo.
- **ExpectedDueDate (Fecha probable de parto):** se **calcula** como fecha de servicio + gestación de
  la especie (bovino ≈ 283 días). Regla determinista, fuente única.
- **Calving (Parto):** hecho que cierra la preñez y da de alta a la(s) cría(s) (Offspring) con genealogía.
- **Weaning (Destete):** separación de la cría de la madre, con peso al destete.

## 6. Trazabilidad y sincronización

- **Event (Evento / Hecho):** unidad inmutable de la historia de un animal (nacimiento, pesaje,
  tratamiento, movimiento, servicio, parto…). El estado es una proyección de los eventos.
- **Device (Dispositivo):** un teléfono/tablet de campo registrado que captura offline y sincroniza.
- **Changeset:** paquete inmutable de operaciones locales de un dispositivo — unidad de sincronización.
- **Conflict (Conflicto):** situación que la convergencia automática no resuelve sola (ej. dos estados
  terminales concurrentes) y queda en cola de revisión; nunca se descartan datos en silencio.

## 7. Alertas

- **Alert (Alerta):** señal generada por una **Rule (Regla)** cuando una condición del dominio se cumple
  (retiro activo, vacuna por vencer, parto próximo, preñez vencida). Tiene severidad y estados
  (abierta → reconocida → resuelta/descartada).

---

## Términos que aún NO tienen Value Object

Están en el lenguaje, pero se formalizan cuando su regla lo justifique (YAGNI): Company, Paddock,
Movement, Species, Category, ADG, BodyCondition, y todo lo de las secciones 4–7. Value Objects
planificados en este sprint (F2): `TenantId`, `FarmId`, `AnimalId`, `LotId` (F2.1) · `TagNumber`
(F2.2) · `Weight` (F2.3) · `Breed`, `Sex` (F2.4).
