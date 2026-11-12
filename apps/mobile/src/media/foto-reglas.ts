/**
 * Qué foto se sube y de qué tamaño. Mismas reglas que la web (`apps/web/src/lib/image.ts`), por
 * la misma razón y con los mismos números: una sola decisión de producto, dos clientes.
 *
 * El problema real: una foto de teléfono actual pesa entre 3 y 12 MB, y viaja en base64 dentro de
 * un JSON, que **infla un 33%**. Achicarla ANTES de que salga importa más en el móvil que en la
 * web: el teléfono está en el campo, con la peor señal, que es exactamente donde 16 MB se cortan.
 *
 * Módulo puro: decide los números, no toca la cámara.
 */

/** Lado largo máximo. 1600 px alcanza de sobra para reconocer un animal y hacer zoom en la caravana. */
export const LADO_MAXIMO = 1600;

/** Calidad JPEG: 0,82 es el punto donde bajar más ya se nota en pantalla. */
export const CALIDAD = 0.82;

/** Techo del servidor (`MediaService.MAX_BYTES`). Acá sirve para avisar antes de intentar subir. */
export const MAX_BYTES = 12 * 1024 * 1024;

/** Bytes reales que representa un data URL (el base64 pesa ~4/3 de lo que codifica). */
export function bytesDeDataUrl(dataUrl: string): number {
  const coma = dataUrl.indexOf(',');
  if (coma < 0) return 0;
  const base64 = dataUrl.slice(coma + 1);
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - relleno);
}

/**
 * A cuánto hay que achicar. Devuelve `null` si la foto ya entra: pedirle a la librería que
 * «redimensione» a su propio tamaño es trabajo y pérdida de calidad a cambio de nada.
 */
export function medidaDestino(ancho: number, alto: number): { width: number } | { height: number } | null {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null;
  const lado = Math.max(ancho, alto);
  if (lado <= LADO_MAXIMO) return null;
  return ancho >= alto ? { width: LADO_MAXIMO } : { height: LADO_MAXIMO };
}

/** Texto para el aviso: «2,4 MB», «812 KB». */
export function describirTamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * ¿Se puede intentar subir? El servidor rechaza por encima de `MAX_BYTES`, y un rechazo después de
 * mandar 16 MB por una conexión de campo es el peor desenlace posible: se avisa antes de salir.
 */
export function motivoParaNoSubir(dataUrl: string): string | null {
  const bytes = bytesDeDataUrl(dataUrl);
  if (bytes === 0) return 'La foto quedó vacía.';
  if (bytes > MAX_BYTES) {
    return `La foto pesa ${describirTamano(bytes)} y el máximo es ${describirTamano(MAX_BYTES)}.`;
  }
  return null;
}
