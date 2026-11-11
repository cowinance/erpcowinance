# Plan: la app móvil, de proyecto a producto

**Fecha:** 2026-11-11 · **Estado: Fases 0 y 1 hechas salvo lo que pide un teléfono** · **Origen:** pedido del productor —
*«rehacer la app móvil, hacerla nativa para Android y iOS, hacerla más profesional»*

> **Cómo leer este documento.** El pedido traía tres cosas juntas —rehacer, nativa, profesional— y
> el análisis encontró que solo una es real. La primera sección explica por qué, porque de ahí sale
> todo el resto del plan. Los números salen de medir el repositorio en `d25d6c3`.

---

## El diagnóstico en una línea

**La app ya es nativa en los dos sistemas; lo que nunca se hizo fue terminar de empaquetarla.**

No se siente profesional porque arranca con el logo de Expo, no se puede compilar para Android, y
no se puede instalar desde ninguna tienda. Eso se arregla en días. Lo que sí falta de verdad —y
nadie lo pidió con esas palabras— es que sirva para trabajar con un animal adelante.

---

## 1. Por qué no hay que rehacerla

### React Native no es una web embebida

Compila a vistas nativas reales: `UIView` en iOS, `android.view` en Android. Lo que hoy está en
`apps/mobile` ya corre nativo en los dos sistemas, con SQLite nativo (`expo-sqlite`), notificaciones
push nativas, hápticos y gestos. No hay un navegador escondido adentro.

### Lo que se tiraría al reescribir

El motor de sincronización offline. No es una capa de red: es el corazón del producto.

| Pieza | Qué resuelve |
|---|---|
| `sync-core` · HLC | Ordenar cambios de varios dispositivos sin reloj común |
| `sync-core` · merge | Última-escritura-gana **por campo**, no por fila |
| `sync-core` · convergencia | Probado: dos dispositivos que editan a ciegas terminan igual |
| `storage.native` | SQLite con WAL y escrituras incrementales — decenas de miles de filas sin serializar snapshots |
| `SyncContext` | Cola de pendientes, bootstrap, cursor, resolución de conflictos, permisos por rol |

Son entre seis meses y un año de ingeniería difícil, con tests que ya pasan. **Reescribirlo en Swift
y en Kotlin es hacerlo dos veces y volver a cero en confiabilidad**, para terminar con la misma
funcionalidad.

### Cuándo SÍ tendría sentido lo nativo puro

Para no cerrar la puerta por dogma. Tres casos legítimos:

1. **Rendimiento gráfico sostenido** — mapas con miles de polígonos, animaciones a 120 Hz. No es el
   caso: la app muestra listas y formularios.
2. **Una API del sistema que React Native no exponga.** Hoy no hay ninguna en juego.
3. **Un SDK de fabricante solo nativo** — el caso de los lectores RFID. **Y este sí aplica**, pero
   se resuelve sin reescribir nada: ver Fase 2.

---

## 2. Lo que sí está mal, medido

### Empaquetado — por esto se ve como un demo

| Hallazgo | Evidencia |
|---|---|
| La pantalla de arranque es el logo de Expo | `splash-icon.png` pesa 3317 bytes, exactamente igual que `expo-logo.png` |
| **El icono de la app también era el de Expo** | `icon.png` y `android-icon-foreground.png` eran el chevron azul; `ios.icon` apuntaba al bundle `assets/expo.icon` |
| Quedaron los assets del template | `expo-badge.png`, `react-logo@2x/@3x.png`, `tutorial-web.png` |
| **`android.package` no está definido** | `app.json` tiene `ios.bundleIdentifier` pero Android no — bloquea la compilación |
| No existe `eas.json` | No hay pipeline: la app nunca se construyó para una tienda |

### Robustez

- **Sin límite de errores (`ErrorBoundary`):** cero archivos. Un error de render en el potrero deja
  pantalla blanca, sin forma de volver.
- **Sin reporte de fallos:** cero archivos. Si algo falla en el campo, nadie se entera nunca.
- **`SyncContext.tsx` tiene 1.485 líneas** — 3,4 veces el siguiente archivo, y 485 por encima del
  techo que la API hace cumplir para cualquier servicio. El móvil no tiene ese gate.
- **562 líneas de test contra 6.912 de código** (proporción 0,08). El archivo más crítico del
  sistema está entre lo menos probado.

### Producto — el hueco más grande

- **No hay cámara, ni lector de código de barras, ni RFID.** La caravana se escribe a mano con
  teclado numérico, sujetando un animal en la manga.
- **No hay fotos del animal**, aunque la API tiene el módulo `media` construido y sin usar.
- **La pestaña Mapa es un cartel** que dice «llegan en la Fase 2 del roadmap». Una de las cinco
  pestañas no hace nada.

### Lo que está bien y no hay que tocar

- Expo SDK 57 y React Native 0.86: al día.
- El tema **deriva de `@cowinance/design-tokens`**, la misma fuente que la web. Sin deriva.
- La interfaz ya respeta los permisos por rol (`sync.puede`), en capturas y en la manga.
- 17 pantallas cubriendo inicio, animales, menú, seis flujos de captura, manga, tareas,
  notificaciones y sincronización.

---

## 3. Decisiones a tomar ANTES de escribir código

Las tres cambian el plan, no solo el detalle.

### D-1 · ¿Lector RFID, y de qué marca?

Define si alcanza con Bluetooth genérico (SPP/BLE) o hace falta envolver un SDK de fabricante.
Allflex, Tru-Test y Datamars son los habituales y cada uno trae lo suyo. **Si la respuesta es sí,
hay que pasar a *development builds* en la Fase 0, no en la 2** — porque Expo Go no carga módulos
nativos propios.

### D-2 · ¿Distribución por tienda o interna?

Tienda: Apple 99 USD al año, Google 25 una vez, más revisiones de días. Interna: se reparte el
`.apk` o por TestFlight/Enterprise, sin revisión. Cambia los tiempos de cada entrega, no el código.

### D-4 · ¿Reporte de fallos a un servicio, y a cuál?

Sentry y sus alternativas piden cuenta y un DSN, igual que EAS. La Fase 1 dejó el registro local y
la costura para enviarlo; falta decidir si se manda y adónde. Sin servicio, los fallos solo se ven
si alguien abre la pantalla de Sincronización y los copia.

### D-3 · ¿Hay Mac disponible?

Compilar para iOS lo exige, salvo que se usen las compilaciones en la nube de EAS. Si no hay Mac ni
presupuesto de nube, **Android primero** y iOS después es una secuencia razonable.

---

## FASE 0 · Que se pueda instalar — 2-3 días

Lo que convierte «un proyecto» en «una app». Nada de esto es difícil; está sin hacer.

1. ✅ `android.package` en `app.json` (`com.cowinance.app`, igual que iOS).
2. ✅ Icono, icono adaptativo y splash propios. Borrados los assets del template.
3. ✅ `eas.json` con tres perfiles: desarrollo, vista previa, producción.
4. ⬜ **Primera compilación corriendo en un teléfono real.** Es el entregable de la fase: hasta que
   no pase, nada de lo demás se puede verificar de verdad.

Si D-1 es «sí hay RFID», acá se arma además el *development build*, porque todo lo que sigue se
prueba sobre él.

**Cómo se sabe que terminó:** el productor instala la app en su teléfono desde un enlace y entra.

### Lo que se hizo, y lo que falta para el punto 4

El icono de la app **también era el de Expo**, no solo el splash: `ios.icon` apuntaba al bundle
`assets/expo.icon` y el chevron azul era el que se veía en la pantalla de inicio. Como no existe
ningún archivo de marca en el repo —el monograma lo dibuja `LoginScreen` con una `<Text>`— los
assets se generaron por geometría desde `@cowinance/design-tokens`: una «C» blanca sobre
`brand-700 #1f4e3d`, con la marca al 42 % del lienzo en el adaptativo para caer sobre la keyline de
Material. Si más adelante aparece un logo de diseñador, se reemplazan los cinco PNG y nada más
cambia.

Verificado con `expo prebuild`: genera `applicationId com.cowinance.app`, los tres drawables del
icono adaptativo y el splash con variante nocturna. `expo-doctor` pasa 21/21 y el gate del
monorepo sigue verde.

Faltan **tres cosas que no son código** para cerrar la fase:

- **Cuenta de Expo** (`eas login` + `eas init`), que fija el `projectId` y habilita `eas build`.
- **Una API alcanzable desde el teléfono.** `EXPO_PUBLIC_API_URL` cae a `http://localhost:3001/v1`,
  que en un teléfono es el propio teléfono. Se documentó en `apps/mobile/.env.example`; para probar
  contra la laptop hay que poner su IP de LAN. Sin esto la app instala pero no entra.
- **D-2 y D-3** (ver arriba): definen si la primera entrega es un `.apk` por enlace o va a tienda.

---

## FASE 1 · Que se pueda confiar — 1 semana

1. ✅ **`ErrorBoundary` en la raíz**, con pantalla de recuperación que conserve la cola de
   pendientes. Hoy un error de render pierde la pantalla; no puede además poner en riesgo el
   trabajo del día.
2. ◐ **Reporte de fallos** (Sentry u otro), con el identificador del dispositivo que ya existe. Sin
   esto, los errores del campo son invisibles.
3. ✅ **Partir `SyncContext`** por las costuras que ya tiene. La API hizo esto tres veces con buen
   resultado; el método es cortar por donde el archivo ya está dividido, no inventar divisiones
   nuevas.
4. ✅ **Extender el gate de tamaño al móvil**, con el mismo criterio que la API.
5. ✅ **Tests de lo que duele perder:** cola de pendientes, cambio de organización, y que un rechazo
   del servidor no borre trabajo local.

**Cómo se sabe que terminó:** el gate cubre el móvil, y matar la app con cambios en cola no pierde
ninguno.

### Cómo quedó

`SyncContext.tsx` pasó de **1.485 a 738 líneas**, cortado por donde ya estaba dividido:
`sync-types` (las formas de datos), `store-queries` (todo lo que la app lee, como funciones puras),
`capture-actions` (las veinte capturas) y `session-rules` (las dos decisiones que descartan la base
local). Los cuatro son `.ts` sin React ni Expo, que es el requisito para que el runner del monorepo
los tome — y era la razón real de la falta de tests, no una consecuencia.

Apareció `capturar()`, que encierra el ciclo que estaba repetido veinte veces: escribir, confirmar,
avisar a la UI, programar el envío. Cada repetición era una ocasión de olvidarse del `commit()`,
que es exactamente cómo una captura se pierde sin dejar rastro.

**La proporción de tests del móvil subió de 0,08 a 0,19** (1.406 líneas de test sobre 7.409 de
código), con 85 tests nuevos. Los que importan, porque fijan invariantes que un refactor rompe en
silencio:

| Qué fija | Por qué |
|---|---|
| El retiro de carne se cuenta en la zona del teléfono | En UTC salía corrido hacia ANTES: carne con residuos dada por habilitada |
| El retiro efectivo combina servidor + capturas offline | Gana el más lejano; quedarse con el del servidor diría que el animal ya está apto |
| El nombre del lote se resuelve del catálogo | El `lot_name` denormalizado queda viejo tras un movimiento |
| Mortalidad, destete y movimiento emiten UNA sola op | Patrón B: el estado y su hecho tienen que viajar juntos |
| `sync()` vacía la cola DESPUÉS del push | Se comprobó moviendo esa línea: compila igual y mata tres tests |
| Volver a entrar con la misma cuenta no toca el disco | Contar pendientes implica restaurar el store del dueño previo |

El gate de tamaño ahora cubre el móvil, techo en 800 líneas para `.ts` y `.tsx` —en el móvil la
lógica vive en componentes—, peor caso 774 (`manga.tsx`). Se verificó que muerde bajándolo a 700 y
viéndolo nombrar los dos infractores.

### Lo que quedó a medias y por qué

**El reporte de fallos es local, no remoto.** Se registran los últimos diez fallos en el
dispositivo, con la pila recortada y las credenciales tapadas, y aparecen en la pantalla de
Sincronización con el identificador del dispositivo al pie. Deliberadamente fuera del motor de
sync: un registrador que depende de la pieza que puede estar rota no registra nada el día que
importa. Mandarlos a un servicio es **D-4** (abajo) y es aditivo: la costura ya está.

**El criterio de cierre está probado en test, no en un teléfono.** Que `restore` conserve la cola
está fijado por tests; que matar la app de verdad no pierda nada depende de la Fase 0 punto 4.

---

## FASE 2 · Que sirva en la manga — 2-3 semanas

La fase que cambia el producto. Hoy el trabajo de campo se hace tecleando.

1. **Lectura de caravana por cámara.** Código de barras donde exista; OCR del número visual donde
   no. Con confirmación antes de guardar: equivocarse de animal es peor que teclear.
2. **Foto del animal** contra el módulo `media`, que ya está construido y sin usar.
3. **Varilla RFID por Bluetooth** (según D-1). Acá está la única parte real de «hacerla más
   nativa»: si el lector trae SDK nativo, se envuelve en un módulo propio y Expo lo carga sin
   problema. **Eso no es reescribir la app: es compilar distinto.**
4. **La pestaña Mapa**, o se construye o se saca. Una pestaña que dice «en el futuro» ocupa el 20%
   de la navegación sin dar nada.

**Cómo se sabe que terminó:** una sesión de manga completa sin tocar el teclado.

---

## FASE 3 · Que se sienta producto — continuo

No es una fase con fecha; es el criterio con el que se trabaja después.

- **Accesibilidad de verdad:** hoy cuatro archivos la mencionan. Con el texto del sistema en grande,
  la app tiene que seguir siendo usable — el gate ya impide los altos fijos, que es el primer paso.
- **Las condiciones reales:** sol directo, guantes, una sola mano, batería al 10%.
- **Actualizaciones por aire** (EAS Update) para arreglar sin pasar por revisión de tienda. Para una
  app de campo, esperar tres días una corrección es mucho.
- **Qué NO hacer:** analítica de producto antes de tener usuarios. Mide nada y cuesta confianza.

---

## Lo que este plan NO hace

- **No reescribe el motor de sincronización.** Es lo más valioso que tiene el proyecto.
- **No migra a Swift/Kotlin.** El análisis de la sección 1 explica por qué; si la decisión cambia,
  el costo honesto es reescribir el motor dos veces.
- **No agrega funcionalidad del catálogo.** Mapa es la excepción, y solo porque ya ocupa una pestaña.
- **No toca la web ni la API**, salvo que la Fase 2 encuentre que falta algo del lado servidor.

---

## Orden y criterio

Las fases están ordenadas por **riesgo que eliminan**, no por visibilidad:

```
Fase 0  sin esto, nada se puede probar en un teléfono de verdad
Fase 1  sin esto, un error en el campo no deja rastro y puede costar el día de trabajo
Fase 2  sin esto, la app funciona pero no se usa
Fase 3  sin esto, la app se usa pero incomoda
```

La tentación natural es empezar por la 2, que es la que se ve. Pero construir lectura de caravana
sobre una app que no se puede instalar ni reporta fallos es construir sobre algo que no se puede
verificar.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El SDK del lector RFID solo tiene versión Android | Se entrega Android primero; iOS teclea mientras tanto. No bloquea. |
| La revisión de Apple rechaza la primera entrega | Entregar a TestFlight en la Fase 0, no al final: el rechazo aparece temprano y barato. |
| ~~Partir `SyncContext` rompe algo sutil~~ | Mitigado distinto de lo planeado: el plan decía escribir los tests ANTES de partir, y se escribieron contra cada módulo **recién extraído**. Escribirlos antes habría exigido montar React y Expo —que es justamente lo que impedía probarlo—. A cambio: se partió en pasos chicos, con typecheck verde en cada uno, sin tocar el contrato público (ninguna pantalla cambió), y los dos cambios de comportamiento son deliberados y están anotados. |
| OCR de caravanas poco confiable con barro o pelo | Confirmación obligatoria antes de guardar, y el teclado siempre disponible como salida. |

---

## Lo que queda abierto

- **El ciclo de captura offline nunca se verificó en un dispositivo real.** Guardar sin señal, verlo
  en la cola, y que suba al sincronizar. La Fase 0 lo habilita; conviene que sea lo primero que se
  pruebe sobre la primera compilación. La Fase 1 lo dejó fijado por tests —la cola sobrevive a un
  push fallido y a un `restore` desde disco— pero eso no reemplaza apagar el teléfono y volver.
- **La tarjeta de fallos de la pantalla de Sincronización no se probó en uso.** El `ErrorBoundary`
  sí: se forzó un error real en el navegador y apareció la pantalla de recuperación con el fallo
  persistido. La tarjeta pide sesión, así que queda para la primera corrida con API.
- **Los dos cambios de comportamiento del refactor**, por si alguno sorprende: una nota que queda
  vacía tras el trim ya no programa un sync (antes lo programaba sin tener nada que enviar), y
  volver a entrar con la misma cuenta ya no restaura el store solo para contar pendientes.
- ~~**27 vulnerabilidades de dependencias en el móvil** (1 crítica).~~ Resuelto en la Fase 0 con
  `expo install --fix` (22 paquetes al parche que el SDK 57 espera) más `npm audit fix`: **27 → 8,
  ninguna crítica**. Las 8 que quedan son de herramientas de build y solo se cierran saltando a
  Expo SDK 58; no corresponde mezclar eso con el empaquetado.
