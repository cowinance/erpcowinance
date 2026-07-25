/**
 * Preparación de imágenes antes de subirlas.
 *
 * El problema real: una foto de teléfono actual pesa entre 3 y 12 MB, y la subida las mandaba tal
 * cual. Encima viajan en base64 dentro de un JSON, que **infla un 33%** — 12 MB de foto son 16 MB de
 * cuerpo. Resultado: «error de carga» para lo más normal del mundo, que es sacar la foto con el
 * teléfono en el corral.
 *
 * **Por qué se achica ACÁ y no en el servidor.** Redimensionar del lado del servidor obliga a que la
 * foto entera VIAJE primero, y en el campo la señal es mala: 16 MB por una conexión débil tarda o se
 * corta, que es exactamente donde más duele. Achicándola antes de que salga, sube ~300 KB y el
 * usuario no hace nada distinto: saca la foto y listo.
 *
 * **Nunca falla hacia atrás.** Si algo del redimensionado no funciona —navegador raro, formato que
 * el canvas no decodifica, memoria— se manda el original. Achicar es una mejora, no un requisito
 * nuevo: que el trabajo de campo no se caiga por una limitación del navegador.
 */

/** Lado largo máximo. 1600 px alcanza de sobra para reconocer un animal y hacer zoom en la caravana. */
const MAX_EDGE = 1600;
/** Calidad JPEG: 0.82 es el punto donde bajar más ya se nota en pantalla. */
const QUALITY = 0.82;

export interface PreparedImage {
  dataUrl: string;
  /** Bytes que realmente se van a subir (aprox., ya descontando el base64). */
  bytes: number;
  /** Bytes del archivo original, para poder contarle al usuario cuánto se ahorró. */
  originalBytes: number;
  /** `false` si hubo que mandar el original tal cual. */
  resized: boolean;
}

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });

/** Tamaño real de un data URL en bytes (el base64 pesa ~4/3 de lo que representa). */
export const dataUrlBytes = (dataUrl: string): number => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
};

/**
 * Decodifica respetando la ORIENTACIÓN EXIF. Sin esto, las fotos verticales del teléfono se suben
 * acostadas: el canvas ignora el flag de rotación que el visor de fotos sí aplica, así que en la
 * pantalla del teléfono se ven bien y en la ficha del animal aparecen de costado.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Sigue al camino de <img>, que en los navegadores actuales también respeta el EXIF.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = url;
    });
  } finally {
    // Se libera igual haya salido bien o mal: cada objectURL que queda vivo retiene la foto entera
    // en memoria, y en un teléfono cargando varias eso se nota.
    URL.revokeObjectURL(url);
  }
}

/**
 * Achica la imagen si hace falta y la devuelve como data URL lista para subir. Si ya es chica, la
 * manda tal cual (no tiene sentido re-comprimir y perder calidad para nada).
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const originalBytes = file.size;
  const original = async (): Promise<PreparedImage> => {
    const dataUrl = await readAsDataUrl(file);
    return { dataUrl, bytes: dataUrlBytes(dataUrl), originalBytes, resized: false };
  };

  // Los formatos que el canvas no dibuja bien (HEIC sin soporte, SVG, GIF animado) van derecho.
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return original();

  try {
    const img = await decode(file);
    const w = 'width' in img ? img.width : 0;
    const h = 'height' in img ? img.height : 0;
    if (!w || !h) return original();

    const escala = Math.min(1, MAX_EDGE / Math.max(w, h));
    // Ya entra: re-comprimirla solo perdería calidad.
    if (escala === 1 && originalBytes <= 1_500_000) {
      if ('close' in img) img.close();
      return original();
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * escala);
    canvas.height = Math.round(h * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return original();
    ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    if ('close' in img) img.close(); // libera el bitmap: son varios MB en memoria

    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const bytes = dataUrlBytes(dataUrl);
    // Si el "achicado" salió más pesado (pasa con PNG chicos o imágenes ya muy comprimidas), gana
    // el original.
    if (bytes >= originalBytes) return original();
    return { dataUrl, bytes, originalBytes, resized: true };
  } catch {
    return original();
  }
}

/** Tamaño legible para poder decírselo al usuario. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
