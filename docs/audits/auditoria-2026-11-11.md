# Auditoría de arquitectura y cobertura — Cowinance ERP · 11 de noviembre de 2026

Tercera auditoría del proyecto. Las dos anteriores miraron cosas distintas y las dos cerraron:

| | Qué miró | Resultado |
|---|---|---|
| [24 jul 2026](auditoria-2026-07-24.md) | Seguridad y preparación para producción | 6 hallazgos, los 6 corregidos |
| Agosto 2026 (sin documento) | Control de acceso, salud del CI, portabilidad | Matriz de permisos, CI de 73 corridas rojas a verde |

**Esta mira lo que ninguna miró: el estado del código como un todo, incluidas la web y el móvil.**
Las dos auditorías previas se concentraron en la API; la web tiene 30.661 líneas y nunca se revisó.

Todo lo que sigue sale de medir el repositorio en `628efef`, no de leerlo por encima. El gate de
arquitectura está verde en sus once invariantes y la suite pasa 2.185 tests.

---

## 1. Qué hay construido

```
993 archivos .ts/.tsx · 143 tablas · 480 rutas HTTP · 35 de 45 módulos del catálogo
```

| Área | Código | Archivos | Qué es |
|---|---|---|---|
| **API** | 37.383 loc | 301 | 39 módulos NestJS, 480 rutas, 67 controladores |
| **Web** | 30.661 loc | 243 | 80 páginas Next.js, 20 componentes compartidos |
| **Dominio** | 6.938 loc | 101 | Las reglas de negocio, puras, sin dependencias |
| **Móvil** | 6.912 loc | 41 | 17 pantallas Expo, offline-first |
| **Sync-core** | 691 loc | 8 | Relojes híbridos, merge por campo, convergencia |
| **Tokens** | 452 loc | 2 | Fuente única del design system |

El dominio es el activo más valioso y el más chico: 101 reglas puras —gestación, retiros,
consanguinidad, IVA, costeo, rotación de stock— que no saben de HTTP ni de base de datos. Es lo que
hace que la misma regla valga igual en la web, en el móvil y en el canal de sincronización.

### Reglas de negocio, por dominio

```
genetics      11 reglas  1519 loc      reproduction   8 reglas   615 loc
finance        5 reglas   323 loc      health         5 reglas   408 loc
tax            5 reglas   581 loc      value-objects  5 reglas   311 loc
costing        3 reglas   241 loc      herd           3 reglas   257 loc
production     3 reglas   185 loc      + 17 dominios más con 1-2 reglas
```

---

## 2. Dónde está la protección, y dónde no

Este es el hallazgo central de la auditoría. La proporción entre código y test por área:

| Área | Código | Test | Proporción | |
|---|---|---|---|---|
| **Dominio** | 6.938 | 5.468 | **0,79** | casi 1:1, 68 archivos de test |
| **API** | 37.383 | 23.516 | **0,63** | 164 archivos de test |
| **Sync-core** | 691 | 282 | **0,41** | |
| **Móvil** | 6.912 | 562 | **0,08** | 7 archivos |
| **Web** | **30.661** | **384** | **0,01** | **6 archivos** |

**La web es la segunda área más grande del repositorio y está protegida por 384 líneas de test.**
Lo único que la cubre de verdad son los 40 specs de Playwright, que recorren flujos completos pero
no ejercitan un componente aislado ni un caso borde.

No es un reproche al diseño: la decisión declarada es «la API se prueba por E2E». Pero esa decisión
se tomó cuando la web era un cliente delgado, y hoy tiene 30.000 líneas con lógica propia —
`ReportsView` (681), `LotsManager` (654), `TasksBoard` (651), `CostingView` (606)— que arma
agregados, ordena, filtra y formatea. Esa lógica no la ve ningún test unitario.

---

## 3. Hallazgos

### H-1 · ALTO — `AuthService` no tiene un solo test

`apps/api/src/modules/auth/` tiene 594 líneas de código y 39 de test. Esas 39 son
`jwt-secret.test.ts`, que prueba la resolución de la clave — una guarda de configuración
importante, agregada por la auditoría de julio, pero que no toca el servicio.

Lo que queda sin un test directo es el módulo más sensible del sistema:

| Método | Qué hace | Por qué importa |
|---|---|---|
| `refresh` | Rotación, **detección de reuso** | Si se reusa un refresh, revoca TODAS las sesiones. Es un mecanismo antirrobo. |
| `refresh` | **Revalida la asignación de rol** | Cierra el agujero por el que un usuario revocado seguía entrando 7 días. |
| `login` | Selección de organización | Multi-finca: elegir mal manda a la persona a la finca equivocada. |
| `switchOrganization` | Cambio sin re-autenticar | Emite tokens para otro tenant. |
| `assertOrganizationActive` | Organización suspendida | Es lo único que hace real el botón de suspender del panel. |
| `me` | Carga de suplantación | De ahí sale la franja que avisa «estás viendo la finca de un cliente». |

La revalidación del refresh la verifiqué a mano contra la API en agosto y funciona, pero **nunca se
escribió el test**. Un agujero de seguridad cerrado sin test puede reabrirse en silencio: es
exactamente el tipo de regresión que nadie nota hasta que alguien la usa.

### H-2 · ALTO — La web no tiene tests de unidad

Ver la tabla de la sección 2. 30.661 líneas, 6 archivos de test, 384 líneas.

Los 40 specs de Playwright son buenos y cubren el recorrido crítico, pero son caros (5 minutos la
suite completa), corren en serie, y **un spec roto contamina a los que vienen después** — se
comprobó en agosto, cuando genética y trazabilidad fallaban por arrastre de specs rotos anteriores.

Lo que no cubre nadie: el formateo de cifras, los agregados que arma el cliente, el orden de las
tablas, los estados vacíos, y la lógica de los cuatro componentes de más de 600 líneas.

### H-3 · MEDIO — `SyncContext.tsx` tiene 1.485 líneas y ningún techo lo frena

Es el archivo más grande del móvil por un factor de 3,4 contra el siguiente (`manga.tsx`, 773).

La API tiene un gate que **bloquea** si un servicio pasa de 1.000 líneas — un trinquete que ya se
bajó dos veces de forma deliberada. El móvil no tiene ese control, así que su archivo central está
485 líneas por encima del límite que la API considera inaceptable.

Y no es un archivo cualquiera: concentra la sesión, el almacén local, la cola de cambios, el
bootstrap, el merge, los permisos y las notificaciones. Es el único lugar donde un error deja al
productor sin poder trabajar en el campo.

### H-4 · MEDIO — `media` sirve archivos por token firmado y no tiene tests

197 líneas, cero tests. Expone cinco rutas, y una de ellas —`GET files/:id/content`— es **pública**
y se autoriza con un token firmado. La lógica de firma vive en `common/file-token.ts`.

Un error ahí no da 500: da acceso a un archivo de otra finca, en silencio.

### H-5 · ALTO — 35 vulnerabilidades de dependencias, 4 críticas

La auditoría de julio reportaba 3 avisos altos sin versión corregida disponible. Tres meses después:

```
críticas 4 · altas 13 · moderadas 16 · bajas 2
```

La buena noticia es que **13 de las 17 críticas y altas ya tienen arreglo sin salto mayor**,
incluida la crítica de `next` que en julio no lo tenía:

| | Paquete | Arreglo |
|---|---|---|
| CRÍTICA | `next` | disponible |
| CRÍTICA | `proxy-addr` | disponible |
| CRÍTICA | `vitest`, `tinypool` | requiere vitest 5 (salto mayor) |
| ALTA | `@nestjs/platform-express`, `body-parser`, `multer`, `nodemailer`, `sharp`, `postcss`, `vite`, y 6 más | disponible |

`multer` y `sharp` son los que más miran hacia afuera: suben y procesan las fotos de los animales.

### H-6 · MEDIO — El README afirma cuatro cosas que ya no son ciertas

La documentación que miente es peor que la que falta, porque se la cree. Cuatro afirmaciones del
README quedaron atrás del código:

| Dice | Realidad |
|---|---|
| «**RBAC superficial**: el rol viaja en el token pero no restringe endpoints todavía» | Falso desde agosto. Hay una matriz de 25 capacidades que **deniega por defecto** sobre 480 rutas, y se aplica también en el canal de sync y en las dos interfaces. |
| «RLS activa y forzada en **24 tablas**» | Son **150**. |
| «**Fechas en UTC**; la presentación por zona horaria queda pendiente» | Implementado: `farmToday`/`farmTimeZone`, con tests de integración. La zona viaja al móvil en el bootstrap. |
| «`Idempotency-Key`: el dedupe solo está en sync; en REST es un no-op» | Implementado al menos en casos clínicos, que derivan el id de la clave. |

Además, el README **no menciona** invitaciones, multi-organización, baja de dispositivos ni la
matriz de permisos — todo lo construido en agosto. Alguien que llegue al proyecto leyendo el README
creería que el sistema no tiene control de acceso.

---

## 4. Lo que está sólido

Una auditoría que solo lista problemas miente por omisión. Esto es lo que está bien construido y
conviene no romper:

- **El dominio es puro y está probado casi 1:1.** 101 reglas sin dependencias, 68 archivos de test,
  96,77% de cobertura. Es la razón por la que la misma regla de retiro vale igual en los tres
  canales.
- **El aislamiento entre fincas está verificado de verdad.** 150 tablas con RLS forzada, ejercida en
  CI contra PostgreSQL real con un rol no privilegiado — no solo por el `WHERE tenant_id` de cada
  consulta. Y hay una guarda que impide arrancar en producción con un rol que pueda saltearla.
- **El CI es serio.** Cinco jobs: gates, gates en Windows, aislamiento multi-tenant contra PostgreSQL,
  E2E de 40 specs, y un ensayo completo de backup y restore. Más un Release que levanta el stack real
  y solo publica si arranca, migra y sirve.
- **Los invariantes se hacen cumplir, no se declaran.** Cero ciclos de dependencia (madge), techo de
  tamaño por servicio, tokens de diseño sin deriva, sin altos fijos en el móvil.
- **17 ADR documentan las decisiones**, con el razonamiento y lo que se descartó.
- **La duplicación bajó**: 3,44% contra un baseline de 4,17%.

---

## 5. Plan de mejora

En orden. Los tres primeros son de riesgo y baratos; los dos últimos son estructurales.

### 1 · Actualizar dependencias (H-5) — horas

`npm audit fix` resuelve 13 de las 17 críticas y altas sin salto mayor. Las dos de `vitest`
requieren la versión 5 y conviene hacerlas aparte, porque tocan la infraestructura de pruebas de
todo el repositorio.

Al terminar, el gate completo y el E2E tienen que pasar antes de commitear: un salto de `next` o
`nest` puede romper en runtime sin que el typecheck lo note.

### 2 · Corregir el README (H-6) — horas

Las cuatro afirmaciones desactualizadas, más una sección sobre permisos, invitaciones y
multi-organización. Es el documento que lee quien llega, y hoy describe un sistema sin control de
acceso.

### 3 · Tests de `AuthService` y de `media` (H-1, H-4) — un día

Empezando por lo que protege algo: rotación y detección de reuso del refresh, la revalidación de la
asignación, el cambio de organización, y la firma de los tokens de archivo.

### 4 · Techo de tamaño para el móvil y partir `SyncContext` (H-3) — dos o tres días

Extender el gate al móvil con el mismo criterio que la API, y partir `SyncContext` por costura:
sesión, almacén local, cola de cambios, bootstrap. La API ya hizo esto tres veces y el método está
probado — cortar por las costuras que el archivo ya marca, no inventar unas nuevas.

### 5 · Tests de unidad para la web (H-2) — continuo

No es un proyecto de una semana ni conviene que lo sea. El criterio razonable: **todo componente
nuevo con lógica propia nace con test**, y los cuatro de más de 600 líneas se cubren cuando haya que
tocarlos. El andamiaje ya existe —vitest corre `apps/web/src/**/*.test.ts`— y hoy lo usan seis
archivos.

---

## 6. Qué NO se auditó

Para que nadie lo dé por revisado:

- **El rendimiento con volumen real.** El seed tiene 65 animales. Las consultas del bootstrap de
  sync y de `/dashboard/home` escalan con el hato y nunca se midieron con miles.
- **La app móvil corriendo.** El typecheck pasa y hay tests de su lógica pura, pero el ciclo de
  captura offline completo —guardar sin señal, verlo en la cola, que suba al sincronizar— no se
  ejercitó en un dispositivo.
- **Los 48 documentos de sprint y los 14 `.docx` de especificación**, que pueden tener la misma
  deriva que el README.
- **Accesibilidad**, más allá de los dos invariantes que el gate ya verifica.
