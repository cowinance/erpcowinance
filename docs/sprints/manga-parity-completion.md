# Paridad de la manga: web ↔ móvil — completado

Cierra el diferido que arrastraba `manga-improvement`.

## La brecha real no eran los modos

La nota decía «falta la paridad de los 7 modos en móvil», pero **los siete modos ya estaban** — los
entregó la Fase 2 de la primera auditoría. Medir antes de construir cambió el trabajo por completo.

Lo que faltaba era la **tarjeta del animal**:

| | Web | Móvil (antes) |
|---|---|---|
| Retiro activo | sí | **no** |
| Caso clínico abierto | sí | **no** |
| Parto próximo | sí | **no** |
| Sin lote | sí | sí |
| Sin pesaje reciente | sí | sí |
| ¿Accionables? | sí, tocar salta al modo | **no** |

Las tres que faltaban no son cosméticas. El **retiro activo** es la única con consecuencia
regulatoria y de inocuidad: es lo que impide mandar a faena un animal que no corresponde. Y quien
toma esa decisión no está en la oficina — está en la manga, con el celular.

## Decisiones

**La regla se mudó al dominio.** `mangaCardAlerts` vive en `@cowinance/domain` y la usan los dos
canales. Antes cada uno decidía por su cuenta qué avisar, y por eso divergieron sin que nadie lo
notara. Mismo patrón que `validateWeighing`, que ya se compartía.

**Las alertas son accionables.** Tocar «SIN LOTE · mover» salta al modo Movimiento. Un aviso que
obliga a recordar y navegar —con guantes, en la manga— es un aviso que se ignora.

**El retiro NO es accionable, a propósito.** No hay nada que capturar: hay que esperar. Darle un
destino sugeriría que se puede resolver ahí mismo.

**El retiro combina dos fuentes.** Lo que trajo el bootstrap (tratamientos de cualquier canal) y lo
que ESTE dispositivo capturó sin señal. Gana el más lejano: un tratamiento aplicado recién en la
manga extiende el retiro, y quedarse con el dato del servidor diría que el animal ya está apto
cuando no lo está.

**«Caso abierto» son tres estados, no uno.** `open`, `in_treatment` y `observation` — la misma
definición que usa `herd.lookup`. Si el bootstrap contara solo `open`, el mismo animal mostraría
alerta en la oficina y no en el campo, que es el bug que se estaba corrigiendo.

**Máximo tres alertas.** Más de tres en una tarjeta de manga no se leen: se saltean todas.

## Qué quedó

| Capa | Qué |
|---|---|
| Dominio (`herd/manga-alerts.ts`) | las 5 reglas + `latestWithdrawal`, con `today` inyectable para probar los bordes — 17 tests |
| API (`sync.bootstrap`) | retiro vigente (carne y leche) y casos clínicos abiertos por animal — 8 tests de integración |
| Móvil | `withdrawalOf` en el contexto de sync + tarjeta con las 5 alertas, tocables, rojo para lo que frena |
| Web | usa la regla compartida; sin cambio de comportamiento salvo el texto del retiro, que ahora distingue carne de leche |
| E2E | `41-manga-alertas.spec.ts`: el retiro se ve y NO es botón; las accionables cambian de modo |

## Verificación

1144 tests verdes y el recorrido e2e nuevo en verde: con un animal tratado, sin lote y sin pesaje,
la manga muestra `RETIRO ACTIVO · carne hasta 29/08` como texto no clickeable y las otras dos como
botones que llevan a Movimiento y a Pesaje.

## Qué falta

- **Retiro de leche en la web.** El DTO de `herd.lookup` expone `has_withdrawal` y la fecha de
  carne, pero no la de leche; la web muestra la alerta igual, sin la fecha. El móvil sí tiene las
  dos. Emparejarlo es agregar un campo al DTO.
- **Un teléfono de verdad** — ver abajo: se verificó corriendo la app, pero en el harness de
  navegador, no en un dispositivo.

## Verificado corriendo la app (25 jul 2026)

Sobre el harness de Expo en navegador (`npm run mobile`, react-native-web — el mismo código de
`manga.tsx`), con la API real y un animal preparado con retiro activo, caso clínico grave y sin
lote:

| Alerta | Se ve | Color | Al tocarla |
|---|---|---|---|
| `RETIRO ACTIVO · carne hasta 29/08` | sí | rojo | **nada** (correcto: no es tocable) |
| `CASO ABIERTO (grave) · tratar` | sí | rojo | cambia a **Tratamiento**, con la lista de productos |
| `SIN LOTE · mover` | sí | ámbar | cambia a **Movimiento**, con el selector de lote destino |

El animal además no tenía pesaje, o sea una cuarta alerta candidata: la tarjeta mostró **tres**,
respetando el tope.

**Bug encontrado al hacerlo:** la app **crasheaba al arrancar** en el harness web —
`expo-notifications` expone el módulo pero sus métodos lanzan «is not available on web», y
`PushBridge` llama a `getLastNotificationResponseAsync` en el montaje. Con eso, el camino de
verificación que documenta el README no servía para ninguna pantalla. Corregido con guardas de
plataforma en el módulo de push (commit `0110f82`).

### Lo que sigue faltando: un teléfono de verdad

El harness ejecuta el mismo componente, pero **no es un teléfono**: no cubre gestos táctiles reales,
tamaño de toque con guantes, vibración ni el comportamiento offline del almacenamiento nativo
(SQLite en el dispositivo vs AsyncStorage en web).

No se pudo usar el simulador de iOS: Xcode está instalado pero **sin runtimes de iOS** (`xcrun simctl
list runtimes` vacío), y bajarlos son varios GB con permiso del usuario.

Para probarlo con Expo Go, la API tiene que ser alcanzable desde el teléfono — `localhost` no sirve:

```bash
docker compose up -d db          # opcional; sin esto usa PGlite
npm run api                      # en una terminal
EXPO_PUBLIC_API_URL=http://<IP-de-la-Mac>:3001/v1 npm run start --prefix apps/mobile
```

Con el teléfono en la misma red WiFi, escanear el QR con Expo Go.
