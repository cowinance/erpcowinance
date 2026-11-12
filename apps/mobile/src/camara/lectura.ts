/**
 * Lectura de caravana por cámara: la parte que no necesita cámara.
 *
 * Hoy la caravana se teclea con el teclado numérico, sujetando un animal en la manga. Leerla con
 * la cámara saca las dos manos del teléfono — pero equivocarse de animal es PEOR que teclear, así
 * que nada de lo que se lee se aplica solo: siempre hay una confirmación en el medio.
 *
 * Módulo puro, sin React ni Expo.
 */

/**
 * Los formatos que se escanean. Las caravanas con código de barras del mercado usan Code 128 y
 * Code 39; se agregan QR y Data Matrix porque algunas caravanas electrónicas los imprimen, y EAN
 * porque aparece en etiquetas de manejo. Se deja AFUERA todo lo que no se vio en una caravana: más
 * formatos es más chance de leer cualquier cosa del corral y darla por buena.
 */
export const TIPOS_DE_CODIGO = ['code128', 'code39', 'code93', 'qr', 'datamatrix', 'ean13', 'itf14'] as const;

/**
 * Qué parte de lo leído es la caravana.
 *
 * Un código puede venir con espacios, con un prefijo de URN (`urn:tag:0123`) o como una URL cuyo
 * último segmento es el número. Se conserva solo el tramo final alfanumérico, que es lo que se
 * compara contra `visual_tag`. Si no queda nada utilizable devuelve `null`: es preferible pedir
 * otra lectura a confirmar un animal equivocado.
 */
export function normalizarCodigo(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  const limpio = crudo.trim();
  if (!limpio) return null;
  // Último segmento de una URL o URN; si no hay separadores, es el texto entero.
  const ultimo = limpio.split(/[/:?#=&]/).filter(Boolean).pop() ?? '';
  const soloUtil = ultimo.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
  return soloUtil.length > 0 && soloUtil.length <= 64 ? soloUtil : null;
}

/**
 * La cámara dispara la lectura muchas veces por segundo sobre el mismo código. Sin esto, el primer
 * escaneo abre la confirmación y los siguientes la vuelven a abrir encima.
 *
 * Se acepta una lectura nueva si es un código distinto, o si pasó la ventana desde la anterior —
 * eso último permite volver a leer la MISMA caravana a propósito, que es lo que pasa cuando el
 * operario escanea, cancela y vuelve a apuntar al mismo animal.
 */
export const VENTANA_DE_REPETICION_MS = 2_000;

export function aceptarLectura(
  codigo: string,
  ultima: { codigo: string; en: number } | null,
  ahora: number,
  ventanaMs: number = VENTANA_DE_REPETICION_MS,
): boolean {
  if (!ultima) return true;
  if (ultima.codigo !== codigo) return true;
  return ahora - ultima.en >= ventanaMs;
}
