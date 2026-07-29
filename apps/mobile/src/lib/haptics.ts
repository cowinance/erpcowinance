/**
 * La respuesta táctil de la app.
 *
 * **Por qué importa acá más que en otras apps.** Esta app se usa parado en el corral, con una mano
 * en el celular y la otra en el animal, muchas veces con guantes y con el sol de frente sobre la
 * pantalla. En ese contexto la vibración no es un adorno: es la ÚNICA confirmación que llega sin
 * mirar. Fuera de la manga no había ninguna — se cargaba un tratamiento, se tocaba guardar, y la
 * única forma de saber si había entrado era detenerse a leer la pantalla.
 *
 * **De dónde sale esto.** El modo manga YA vibraba, con `Vibration.vibrate()` y patrones pensados a
 * mano: un doble pulso para el rechazo, uno corto para el animal encontrado. La intención estaba; lo
 * que no llegaba era el resultado. En iOS esa API IGNORA los patrones y las duraciones —vibra un
 * tiempo fijo por elemento— y no pasa por el motor táctil del iPhone. Así que el doble pulso que el
 * autor diseñó se sentía igual que todo lo demás: un zumbido sordo. `expo-haptics` sí usa el motor,
 * y ahí las señales se distinguen entre sí sin mirar.
 *
 * **Qué se elige y por qué.** Cuatro señales, no más. Un patrón por evento hace que la vibración deje
 * de significar algo:
 *
 *  · `ok()` — algo quedó GUARDADO. Es la que más se va a sentir en el día: cada pesaje, cada
 *    tratamiento, cada movimiento. Va como «éxito» del sistema y no como un golpe genérico, así el
 *    iPhone usa su patrón de dos tiempos, que se distingue de un toque cualquiera.
 *
 *  · `error()` — se rechazó. Tiene que sentirse DISTINTO de `ok()` sin mirar la pantalla, porque la
 *    situación en la que hace falta es justamente esa: se guardó al voleo y hay que enterarse.
 *
 *  · `warn()` — hay que CONFIRMAR antes de seguir. Existe porque el código ya lo necesitaba: en la
 *    manga, un peso fuera de rango pide confirmación, y eso no es un éxito ni un error. iOS tiene su
 *    propio patrón para esto, distinto de los otros dos.
 *
 *  · `tap()` — un toque que cambia algo importante, como abrir la captura o encontrar al animal.
 *    Liviano: si cada toque de la interfaz vibrara, en media hora el productor apagaría la háptica
 *    del teléfono.
 *
 * **Lo que NO lleva.** Navegar entre pestañas, tocar un animal de la lista, scrollear. iOS ya da su
 * propia respuesta en esos gestos y agregarle otra encima se siente barato.
 *
 * **Nunca falla hacia el usuario.** No es programación defensiva por si acaso: los docs de Expo v57
 * enumeran cuándo el motor táctil del iPhone queda INACTIVO —modo de bajo consumo, háptica apagada en
 * Ajustes, cámara abierta, dictado activo— y varias de esas pasan en el campo, empezando por el modo
 * de bajo consumo al final de una jornada. En todos esos casos la llamada se descarta en silencio: una
 * confirmación que se cae por no poder vibrar sería mucho peor que no vibrar.
 *
 * **Pendiente en Android.** Los docs recomiendan `performAndroidHapticsAsync`, que no necesita el
 * permiso `VIBRATE`. No se usa todavía porque tiene su propio enum y hay que elegir bien la
 * equivalencia; el camino multiplataforma de acá funciona igual y no es peor que el `Vibration` que
 * había antes, que también pedía ese permiso.
 */
import * as Haptics from 'expo-haptics';

/** Descarta cualquier error: la háptica es un extra y no puede tumbar la acción que la disparó. */
const silencioso = (p: Promise<unknown>) => void p.catch(() => {});

/** Quedó guardado. */
export function ok(): void {
  silencioso(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Se rechazó. Se siente distinto de `ok()` a propósito. */
export function error(): void {
  silencioso(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Hay que confirmar antes de seguir. No es éxito ni error. */
export function warn(): void {
  silencioso(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Un toque que abre o cambia algo. Liviano. */
export function tap(): void {
  silencioso(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
