# Auditoría del ciclo sin señal — Cowinance ERP · 12 de noviembre de 2026

**Qué se miró.** Una sola pregunta: *¿se puede trabajar la jornada completa en el teléfono, en una
zona sin cobertura, y que al volver la señal suba todo, sin perder nada y sin mentir?*

La [auditoría del 11 de noviembre](auditoria-2026-11-11.md) dejó esto explícitamente fuera («el
ciclo de captura offline completo … no se ejercitó»). Esta lo audita por lectura del código y
pruebas ejecutables, no en un teléfono: eso sigue pendiente y ninguna de las dos cosas reemplaza a
la otra.

**Alcance.** `packages/sync-core` (motor), `apps/mobile/src/sync` (provider y persistencia),
`apps/api/src/modules/sync` (push/pull/bootstrap), y el camino de autenticación en cuanto afecta a
un dispositivo que estuvo días sin señal.

---

## Veredicto

El diseño es correcto y la mayor parte del camino está bien resuelta: la UI escribe **solo** contra
el store local, cada captura se cierra en un changeset inmutable que se persiste en SQLite en el
momento, el merge es determinista por campo con relojes híbridos, el servidor deduplica por
`(device, seq)` y el bootstrap trae todo lo que hace falta para operar a ciegas —animales, preñeces
abiertas, productos veterinarios con sus retiros, lotes, tareas pendientes, zona horaria de la finca
y la matriz de permisos resuelta—. Se puede capturar las doce cosas sin señal, y ninguna pantalla de
captura toca la red.

**Pero hay cuatro defectos por los que el trabajo del día se queda sin subir, y en tres de los
cuatro la app dice que está todo al día.** Eso es peor que fallar: nadie va a revisar una cola que
el teléfono informa vacía.

| | Hallazgo | Consecuencia en el campo | Estado |
|---|---|---|---|
| **O-1** | Lo capturado mientras sube la cola se borra de la cola | Se pierde hasta reiniciar la app. El contador dice «todo al día» | ✅ corregido |
| **O-2** | Dos sincronizaciones a la vez pueden revocar la sesión entera | Queda afuera y necesita señal **y** la contraseña para volver | ✅ corregido |
| **O-3** | Un changeset que el servidor no acepta tranca la cola para siempre | Nada sube nunca más. Se reintenta cada 60 s sin avanzar | abierto |
| **O-4** | Si falla la escritura en SQLite, nadie se entera | Disco lleno → la captura vive solo en memoria y muere al cerrar | ✅ corregido |
| **O-5** | No hay tope a la deriva del reloj del teléfono | Un teléfono con la hora adelantada gana todo conflicto para siempre | abierto |
| **O-6** | El pull no drena: trae 500 changesets por sincronización | Tras semanas sin señal, los datos llegan de a tandas | abierto |
| **O-7** | El refresh vence a los 7 días | Más de una semana sin cobertura y el teléfono queda inservible | decisión de producto |
| **O-8** | Las fotos no tienen cola offline | La foto en el corral simplemente falla (ya documentado) | abierto |

---

## O-1 · CRÍTICO — Lo capturado durante un push en vuelo se borra de la cola

**Dónde.** `packages/sync-core/src/device.ts`, en `sync()`:

```ts
const res = await transport.push(this.pending);
pushed = res.accepted + res.deduped;
this.pending = [];            // ← borra TODO, no solo lo que se envió
```

El arreglo se serializa al armar el `fetch`, es decir al principio del `await`. Lo que se capture
durante la ida al servidor entra a `this.pending` **después** de esa foto y **antes** del
`this.pending = []`. Se descarta sin haberse enviado.

**La escena.** El peón pesa un animal. A los 2,5 segundos el debounce dispara la subida; la radio
tarda unos segundos porque la señal es mala. Mientras tanto pesa el siguiente. Esa segunda pesada se
aplicó al store local —se ve en la ficha— pero desapareció de la cola: el contador marca **0 por
subir** y la pantalla dice «todo al día».

**Alcance real del daño.** El changeset sí quedó escrito en SQLite —el evento `flushed` solo borra
los `seq` que se enviaron—, así que **se recupera al reiniciar la app**. Nada se destruye. Pero nada
se lo dice a nadie: hasta el próximo arranque en frío, ese registro no existe para el servidor y la
app afirma lo contrario. En una jornada de corral, con la app abierta todo el día, son horas.

**Probado.** Con una compuerta que retiene el push mientras se captura:

```
× la captura hecha mientras sube la cola NO se pierde
  → expected +0 to be 1      (d.pendingCount === 0; debía ser 1)
```

**Arreglo.** Quitar de la cola exactamente lo que se envió, no vaciarla:

```ts
const enviados = this.pending.slice();
const res = await transport.push(enviados);
const ids = new Set(enviados.map((c) => c.seq));
this.pending = this.pending.filter((c) => !ids.has(c.seq));
```

Es el mismo criterio que ya usa `flushedSeqs` para SQLite; el bug es que la memoria no lo seguía.

---

## O-2 · CRÍTICO — Dos sincronizaciones simultáneas pueden cerrar la sesión en todas partes

**Dónde.** `apps/mobile/src/sync/SyncContext.tsx` (`syncNow` no tiene exclusión mutua) contra
`apps/api/src/modules/auth/auth.service.ts:152`.

`syncNow` se dispara desde cuatro lados: el temporizador de 60 s, el regreso al primer plano, el
debounce de 2,5 s tras cada captura, y el botón. **Ninguno comprueba si ya hay una corriendo** —
`syncing` es estado de render, no un candado.

El token de acceso dura 15 minutos. Pasado ese rato, dos `syncNow` que arranquen juntas reciben 401
las dos, leen el **mismo** `refreshToken` de `metaRef` y las dos llaman a `/auth/refresh`. La primera
lo rota. La segunda cae en la detección de reuso, que es un mecanismo antirrobo y hace lo que tiene
que hacer:

```sql
UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL
```

Eso revoca **todas** las sesiones del usuario, incluido el token que la primera llamada acababa de
emitir y guardar. El teléfono va a la pantalla de ingreso.

**La escena.** Vuelve la señal después de dos horas en el potrero. La app pasa a primer plano y
sincroniza; el temporizador vence casi a la vez. En lugar de subir el día, pide la contraseña — y
pedirla en el campo, sin señal estable y sin el gestor de contraseñas, es quedarse afuera.

Los datos **no** se pierden: la cola sigue en SQLite y `decidirIngreso` bloquea el ingreso de otra
cuenta mientras haya pendientes. Pero el dispositivo queda inútil hasta que se pueda ingresar.

**Lo que no está mal es el servidor.** Revocar ante un reuso es correcto. El defecto es que el
cliente reusa.

**Arreglo.** Dos candados, los dos en el cliente:

- Un *single-flight* en `syncNow`: si hay una en vuelo, devolver esa misma promesa.
- Un *single-flight* en la rotación dentro de `authFetch`: una sola llamada a `/auth/refresh` a la
  vez, y las demás esperan su resultado. Esto hace falta aparte, porque `/agenda` y el refresco de
  notificaciones también pueden recibir 401 en paralelo.

---

## O-3 · ALTO — Un changeset que el servidor rechaza tranca la cola para siempre

**Dónde.** `apps/api/src/modules/sync/sync.service.ts` — `assertPuedeEscribir` lanza
`ForbiddenException` por **todo el push** si una sola operación toca una tabla que el rol no puede
escribir, y `sync.unsupported_op` lanza `BadRequestException` si no hay handler para una tabla.

El cliente hace lo correcto ante un error: no borra la cola. Y entonces reintenta el mismo push cada
60 segundos, para siempre, con el mismo resultado. **La cola no vuelve a drenar nunca**, ni la parte
sana.

**La escena.** Al operario le bajan el rol mientras está en el potrero —deja de poder escribir
`services`—. Ya había cargado un servicio reproductivo y después 40 pesadas. Al volver la señal el
push completo da 403 y las 40 pesadas, que sí tiene permiso de cargar, no suben. El mensaje dice qué
tabla faltó, lo cual está bien, pero no hay forma de sacar el changeset trancado desde la app.

El mismo efecto aparece con una app vieja que emita una tabla que el servidor ya no reconoce, o al
revés.

**Por qué rechazar el push completo sí es correcto.** El comentario del código lo argumenta y el
argumento es bueno: aceptar parcialmente dejaría al dispositivo creyendo que subió todo. El problema
no es la política del servidor, es que **el cliente no tiene salida**. Hoy la única es `resetLocal`,
que borra la base entera —incluido lo que no había subido—.

**Arreglo.** Que el rechazo sea informativo y aislable, no terminal:

- El servidor devuelve **cuál** changeset rechazó (`seq`) y por qué, con un código estable
  (`sync.sin_permiso`, `sync.unsupported_op`) en vez de un 403/400 opaco para todo el lote.
- El cliente mueve ese changeset a una **cola de cuarentena** y sigue subiendo el resto.
- La pantalla de Sincronización muestra la cuarentena con su motivo, y deja descartarlo con un acto
  explícito de la persona. Nunca en silencio.

---

## O-4 · ALTO — Si falla la escritura local, nadie se entera

**Dónde.** `apps/mobile/src/sync/storage.native.ts`:

```ts
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (fn: () => Promise<unknown>) => {
  queue = queue.then(fn, fn);     // ← el error se descarta y la cadena sigue
};
```

Las mutaciones de fila, evento y cola pendiente se encolan con `enqueue` y **nadie espera el
resultado**. Si `runAsync` falla —disco lleno, base bloqueada, SQLite corrupta— la captura queda
aplicada en memoria, visible en la pantalla, y no se escribió en ningún lado. Al cerrar la app
desaparece.

Un teléfono de campo con la memoria llena es lo normal, no lo excepcional: fotos, WhatsApp, mapas.

**Por qué importa más acá que en cualquier otro sistema.** La premisa entera de esta app es que el
dato sobrevive en el dispositivo hasta que haya señal. Si la escritura local puede fallar callada, la
premisa no se cumple y no hay ninguna señal de que no se cumple.

**Arreglo.** Que el fallo sea visible y se cuente:

- `enqueue` captura el error, incrementa un contador de fallos de persistencia y lo expone en el
  contexto.
- La pantalla principal y la de Sincronización muestran una advertencia cuando ese contador no es
  cero, con el texto honesto: *lo capturado puede no estar guardado; sincronizá antes de cerrar la
  app*.
- Un `PRAGMA` de verificación al iniciar, para distinguir «disco lleno» de «base corrupta».

---

## O-5 · MEDIO — No hay tope a la deriva del reloj

**Dónde.** `packages/sync-core/src/hlc.ts`. `tick()` toma `Date.now()` y `lastMs` solo avanza.
`receive()` adopta el máximo entre el reloj local y el remoto.

Un teléfono con la hora adelantada —batería agotada y arranque sin red, hora puesta a mano— emite
HLC en el futuro. Consecuencias, las dos malas:

1. **Ese dispositivo gana todo conflicto LWW, para siempre.** Una corrección hecha después desde la
   web se descarta en silencio, porque su HLC es menor.
2. **Contagia.** Todo dispositivo que reciba ese HLC adopta el `lastMs` futuro por la regla de
   recepción y queda igual de adelantado.

Además la fecha del hecho en sí sale de `new Date()` en las funciones de captura, así que una pesada
queda fechada en el futuro sin que nada lo cuestione.

Esto es un comportamiento conocido de los relojes híbridos y la mitigación es estándar: un tope de
deriva. No está.

**Arreglo.** Un `MAX_DRIFT` (del orden de una hora) en `HlcClock.receive`: un HLC remoto más
adelantado que eso no mueve el reloj local y se registra. Y validar en el servidor, al aceptar el
push, que el HLC no esté absurdamente en el futuro respecto de su propio reloj — el servidor sí tiene
hora confiable.

---

## O-6 · MEDIO — El pull no drena la cola remota

**Dónde.** `sync.service.ts` limita el pull a 500 changesets, y el cliente hace **un solo** pull por
sincronización (`device.ts`, `sync()`).

El cursor avanza bien y no quedan huecos —eso está cuidado y comentado—. Pero un teléfono que estuvo
tres semanas afuera necesita muchas sincronizaciones para ponerse al día, a una cada 60 segundos de
app abierta, y mientras tanto **muestra datos parciales sin decir que son parciales**.

**Arreglo.** Que `sync()` siga pidiendo mientras `changesets.length === limit`, y que la respuesta
traiga cuánto falta para que la pantalla lo pueda decir.

---

## O-7 · MEDIO — El refresh vence a los 7 días

`REFRESH_TTL_S = 7 * 24 * 3600`. Un dispositivo que no vea la red en más de una semana queda sin
sesión y necesita contraseña. La cola no se pierde —`decidirIngreso` la protege— pero el teléfono no
sirve para capturar hasta que haya señal.

Siete días es un valor razonable para la web. Para un teléfono que por diseño trabaja semanas en un
potrero, no: la decisión debería ser explícita y distinta por tipo de dispositivo, y es una decisión
de producto, no mía. Lo dejo planteado.

Hay un segundo filo más fino: si la app muere entre la rotación del token en el servidor y el
`saveMeta` del nuevo, el teléfono se queda con un token ya consumido. Al usarlo cae en la detección
de reuso de O-2. Persistir el token nuevo **antes** de usarlo cierra esa ventana.

---

## O-8 · Conocido — Las fotos no tienen cola offline

`apps/mobile/src/media/FotosDelAnimal.tsx` llama a `authFetch` directo. Sin señal, la foto falla y no
queda nada. Ya está documentado como limitación en el README y en el plan; lo repito porque es la
única captura que **no** cumple la promesa del resto de la app, y la foto de una lesión en el corral
es justamente lo que no se puede volver a tomar al día siguiente.

---

## Lo que está bien, y conviene no romper

- **Ninguna pantalla de captura toca la red.** Las doce capturas escriben contra el store local. Lo
  verifiqué buscando `fetch`/`authFetch` en todas las pantallas: solo aparecen en el ingreso y en
  las fotos.
- **El arranque en frío sin señal funciona.** Con store guardado, `init()` restaura desde SQLite y
  pasa a `ready` sin una sola llamada.
- **Lo que hace falta para decidir a ciegas está persistido a propósito**: zona horaria de la finca,
  capacidades del rol, organizaciones, agenda y notificaciones. Cada una con su razón escrita en
  `storage.types.ts`.
- **Un push fallido no borra la cola** — cubierto por tests desde el 11-11.
- **El servidor deduplica por `(device, seq)`**, así que reintentar es seguro y los reintentos de
  O-3 no duplican nada.
- **El cursor no se corrompe al filtrar por permisos**, y está razonado por qué se filtra después
  del `LIMIT`.
- **El cambio de finca y el ingreso de otra cuenta se bloquean con pendientes** en vez de descartar.
- **El auto-sync se apaga en segundo plano**, que en un día de campo con 10% de batería importa.

---

## Qué NO se auditó

- **Nada de esto corrió en un teléfono.** Sigue siendo la brecha principal y ninguna lectura de
  código la cierra.
- **El volumen.** El bootstrap trae el hato entero en una respuesta; con 65 animales anda. Con
  5.000, ni la consulta ni el tamaño de la respuesta se midieron nunca.
- **La batería y el disco reales** durante una jornada completa de captura.
- **El ciclo con señal intermitente de verdad** —no simulada—, que es el caso que más rompe: la
  radio que va y viene cada pocos segundos.

---

## Orden sugerido

1. **O-1** y **O-2** primero: son los dos que hacen daño hoy, los dos están en el cliente, y los dos
   son pocas líneas con un test que los fija.
2. **O-4**: barato y es la red de seguridad de todo lo demás.
3. **O-3**: es el más grande porque toca el contrato del servidor y la pantalla de Sincronización.
4. **O-5**, **O-6**, **O-7**, **O-8**: después, y **O-7** es una decisión de producto antes que un
   arreglo.

Nada de esto cambia el diseño. Son defectos de implementación en un diseño que resiste la
auditoría — que es la buena noticia del documento.

---

## Cierre del 12-11: O-1, O-2 y O-4 corregidos

**O-1** · `sync()` ahora saca de la cola exactamente los `seq` que envió, en vez de vaciarla.
Tres tests nuevos en `device.test.ts`: que lo capturado durante el push sigue en cola y sube en la
vuelta siguiente, que el aviso de borrado a disco nombra solo lo que viajó, y que dos syncs
concurrentes no dejan nada atrás. Comprobado por mutación: al reponer el `this.pending = []`, el
primero se pone rojo.

**O-2** · Dos candados en el cliente, los dos con su razón escrita al lado:

- `rotarSesion()` — una sola llamada a `/auth/refresh` a la vez; las demás esperan a esa.
- `syncNow()` — una sola sincronización a la vez; quien llegue se cuelga de la que está en vuelo.

El servidor no se tocó: revocar ante un reuso es correcto, el que reusaba era el cliente.

Verificado de punta a punta en el harness web contra la API local, rompiendo la firma del token de
acceso y recargando para que varias peticiones recibieran 401 a la vez. Con tres peticiones
concurrentes en 401 —`/dashboard/home`, `/auth/me`, `/sync/pull`— salió **un solo**
`/auth/refresh`, las tres reintentaron bien y la sesión quedó viva. Antes del arreglo, el mismo
arranque producía pares de refresh y uno de ellos terminaba en `auth.refresh_reused`.

**O-4** · La cola de escritura se extrajo a `cola-de-escritura.ts` —la comparten los dos
adaptadores y así se puede probar en node, cosa que con `expo-sqlite` adentro no se podía—. Ahora
cuenta los fallos, avisa con el motivo y **no** abandona la cadena. El aviso llega a la pantalla:
franja roja en el inicio y una tarjeta con el detalle técnico en Sincronización. Ocho tests nuevos.

**Lo que no se cerró, y hay que decirlo:** O-4 hace *visible* el fallo, no lo evita. Si el teléfono
se queda sin espacio, lo capturado en esa sesión sigue dependiendo de que alguien sincronice antes
de cerrar la app. No hay forma de arreglar eso desde el código.

**Ciclo completo ejercitado** tras los arreglos: ingreso, bootstrap, captura de una nota sobre el
animal 501, encolado y subida; el evento aparece en el timeline del servidor con su texto exacto.
Gate de arquitectura entero en verde (14 invariantes, 238 tests del móvil y sync-core, lint del
móvil en cero).

Sigue sin probarse **en un teléfono**. Nada de lo de arriba cambia eso.
