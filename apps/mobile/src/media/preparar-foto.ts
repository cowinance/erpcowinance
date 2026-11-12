/**
 * Achicar la foto ANTES de que salga del teléfono.
 *
 * Es la misma decisión que tomó la web, pero acá pesa más: el teléfono está en el campo, con la
 * peor señal, y 16 MB por una conexión débil tardan o se cortan. Achicada sube ~300 KB y la
 * persona no hace nada distinto — saca la foto y listo.
 *
 * **Nunca falla hacia atrás.** Si el redimensionado no funciona —formato raro, memoria, lo que
 * sea— se manda el original. Achicar es una mejora, no un requisito nuevo: que el trabajo de
 * campo no se caiga por una limitación de la librería de imágenes.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CALIDAD, bytesDeDataUrl, medidaDestino } from './foto-reglas';

export interface FotoLista {
  dataUrl: string;
  /** Bytes que realmente se van a subir. */
  bytes: number;
  /** `false` si hubo que mandar el original tal cual. */
  achicada: boolean;
}

/**
 * Deja la foto lista para `POST /animals/:id/photos`, que espera un data URL base64.
 *
 * `ancho`/`alto` son los que informó la cámara: sirven para no pedir un redimensionado cuando la
 * foto ya entra, que sería trabajo y pérdida de calidad a cambio de nada.
 */
export async function prepararFoto(
  uri: string,
  ancho: number,
  alto: number,
  originalDataUrl?: string,
): Promise<FotoLista> {
  const original = originalDataUrl ?? uri;
  const medida = medidaDestino(ancho, alto);

  try {
    const contexto = ImageManipulator.manipulate(uri);
    if (medida) contexto.resize(medida);
    const render = await contexto.renderAsync();
    const guardada = await render.saveAsync({ format: SaveFormat.JPEG, compress: CALIDAD, base64: true });
    if (!guardada.base64) throw new Error('la librería no devolvió base64');
    const dataUrl = `data:image/jpeg;base64,${guardada.base64}`;
    return { dataUrl, bytes: bytesDeDataUrl(dataUrl), achicada: !!medida };
  } catch {
    // Mandar el original es peor que achicarlo, y muchísimo mejor que no poder sacar la foto.
    return { dataUrl: original, bytes: bytesDeDataUrl(original), achicada: false };
  }
}
