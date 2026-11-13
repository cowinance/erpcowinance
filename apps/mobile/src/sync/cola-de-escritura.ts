/**
 * Cola de escrituras locales: las serializa para preservar el orden y **cuenta las que fallan**.
 *
 * Vive aparte de los dos adaptadores de almacenamiento (SQLite nativo, AsyncStorage web) por dos
 * razones: la comparten, y acá se puede probar en node — los adaptadores no, porque importan
 * módulos nativos de Expo.
 *
 * Lo que arregla: antes cada adaptador encadenaba con `queue.then(fn, fn)`, que usa el error de
 * una escritura como disparador de la siguiente y lo pierde ahí mismo. La cola seguía andando y
 * la captura desaparecía en silencio. En una app cuya premisa es que el dato sobrevive en el
 * dispositivo hasta que haya señal, una escritura que falla callada rompe la premisa sin dejar
 * rastro — y un teléfono de campo con la memoria llena es lo normal, no lo excepcional.
 */
export interface ColaDeEscritura {
  /**
   * Agenda una escritura detrás de las anteriores. No se espera: la captura tiene que ser
   * instantánea.
   *
   * `etiqueta` dice QUÉ se estaba escribiendo —`row:animals`, `cursor`, `meta`…— y viaja en el
   * aviso de fallo. Sin eso, el motivo que devuelve SQLite llega sin contexto y no se sabe si lo
   * que no entró fue una captura del día o un contador de posición.
   */
  encolar(escribir: () => Promise<unknown>, etiqueta?: string): void;
  /** Espera a que se vacíe lo encolado hasta ahora. Nunca rechaza: los fallos se cuentan, no se lanzan. */
  vaciar(): Promise<void>;
  /** Cuántas escrituras no entraron desde que arrancó la app. */
  readonly fallos: number;
  /** Suscribe el aviso de fallo; devuelve la baja. */
  alFallar(aviso: (fallos: number, detalle: string) => void): () => void;
  /** Vuelve a cero tras un borrado total del almacenamiento. */
  reiniciar(): void;
}

export function crearColaDeEscritura(): ColaDeEscritura {
  let cola: Promise<unknown> = Promise.resolve();
  let fallos = 0;
  let avisar: ((fallos: number, detalle: string) => void) | null = null;

  return {
    encolar(escribir, etiqueta) {
      cola = cola.then(escribir).catch((e: unknown) => {
        fallos++;
        // La cadena NO se abandona: cortarla dejaría de persistir todo lo que venga después, que
        // es peor que el fallo puntual. Se cuenta, se avisa y se sigue.
        const motivo = e instanceof Error ? e.message : String(e);
        avisar?.(fallos, etiqueta ? `${etiqueta}: ${motivo}` : motivo);
      });
    },
    vaciar() {
      return cola.then(
        () => undefined,
        () => undefined,
      );
    },
    get fallos() {
      return fallos;
    },
    alFallar(aviso) {
      avisar = aviso;
      return () => {
        if (avisar === aviso) avisar = null;
      };
    },
    reiniciar() {
      fallos = 0;
    },
  };
}
