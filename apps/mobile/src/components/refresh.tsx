/**
 * Tirar hacia abajo para actualizar.
 *
 * **Qué faltaba.** `RefreshControl` no estaba importado ni una vez en toda la app. Es el gesto que
 * cualquiera prueba primero cuando sospecha que lo que ve está viejo, y acá esa sospecha es la
 * norma: la app trabaja contra la base LOCAL y lo que hay en pantalla es del último sync. Sin el
 * gesto, la única forma de forzarlo era entrar a Sincronización y apretar un botón.
 *
 * **Qué significa «actualizar» acá.** No es volver a pedir la pantalla: es SINCRONIZAR. Primero sube
 * lo que quedó en cola —una vacuna cargada en el potrero sin señal— y después baja lo que cambió en
 * el servidor. Por eso llama a `syncNow` y no a un fetch: el productor que tira hacia abajo quiere
 * que su carga llegue, no solo enterarse de la ajena.
 *
 * **Por qué un hook y no la prop en cada pantalla.** Son seis pantallas, y este proyecto ya se comió
 * dos veces la misma historia: en el arreglo del teclado la lista tenía cinco y la sexta apareció
 * recién al barrer los archivos, y en el de Dynamic Type eran 19 lugares con tres valores distintos
 * para la misma caja. La forma de que la séptima pantalla no se olvide es que no haya nada que
 * recordar.
 *
 * **Sin señal no se cuelga.** `syncNow` nunca rechaza: sin dispositivo, en offline simulado o con la
 * red caída devuelve `{ error }`. El spinner cierra igual, y el estado de sync que ya muestran las
 * pantallas —«Sincronizado» / «N pendientes»— es el que cuenta qué pasó. Tirar hacia abajo sin señal
 * deja la carga en cola, que es exactamente lo que tiene que pasar.
 *
 * `extra` es para lo que una pantalla necesite ADEMÁS del sync: el Inicio recompone su bloque de
 * atención prioritaria, que es un endpoint aparte y no viaja en el sync. Se guarda en una ref para
 * que pasarle una función nueva en cada render no recree el callback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useSync } from '@/sync/SyncContext';
import { useTheme } from '@/useTheme';

export function useSyncRefresh(extra?: () => Promise<unknown> | void) {
  const T = useTheme();
  const sync = useSync();
  const [refreshing, setRefreshing] = useState(false);

  const extraRef = useRef(extra);
  useEffect(() => {
    extraRef.current = extra;
  });

  // Montado: si la pantalla se cierra mientras el sync está en vuelo, no se toca su estado.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await sync.syncNow();
      await extraRef.current?.();
    } finally {
      if (vivo.current) setRefreshing(false);
    }
  }, [sync]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      // iOS usa `tintColor` para la ruedita y Android `colors`. Se dan los dos: la app corre en las
      // dos plataformas y una sola dejaría la otra con el gris del sistema.
      tintColor={T.ink3}
      colors={[T.brand700]}
      progressBackgroundColor={T.surface}
    />
  );
}
