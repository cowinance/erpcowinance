/**
 * Base de la API SIN intermediarios. La usan el código de servidor que habla con api-core
 * directamente: los route handlers de `app/api/*` y `server-api.ts`.
 */
export const DIRECT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

/**
 * Base que usa cada `fetch` de la app — y que cambia según DÓNDE corre:
 *
 *  · En el SERVIDOR (Server Components): api-core directo, sin saltos de más.
 *  · En el NAVEGADOR: el propio origen, contra el proxy `app/api/cw/[...path]`.
 *
 * El proxy existe porque los tokens ahora viven en cookies `HttpOnly` y el JavaScript de la página
 * ya no puede leerlos para armar el `Authorization`; esa cabecera la pone el proxy del lado del
 * servidor, y de paso renueva el token cuando vence. Resolverlo acá —en una sola constante— es lo
 * que permite que los ~200 llamados repartidos por la app sigan escritos igual.
 *
 * Efecto colateral bueno: el navegador nunca habla con la API directamente, así que la web dejó de
 * necesitar CORS.
 */
export const API_URL = typeof window === 'undefined' ? DIRECT_API_URL : '/api/cw';

/**
 * Se conserva para no reescribir los ~200 llamados que ya la usan, pero devuelve vacío: la
 * autenticación la resuelve el proxy con la cookie `HttpOnly`. Antes leía el token de
 * `document.cookie` — exactamente lo que se quitó.
 */
export function authHeaders(): Record<string, string> {
  return {};
}

export interface PhotoRef {
  file_id: string;
  token: string;
  mime: string;
}

/** URL firmada de un archivo (funciona en `<img>` sin cabecera de auth). */
export function fileUrl(ref?: PhotoRef | null): string | null {
  if (!ref?.file_id) return null;
  return `${API_URL}/files/${ref.file_id}/content?t=${ref.token}`;
}

/**
 * Motivo de un error de la API, para mostrárselo al usuario.
 *
 * La API responde `{code, title}` en el cuerpo. Muchas pantallas leían `body.message.title` —que
 * existe en los errores genéricos de Nest, no en los del dominio— y esa propiedad da SIEMPRE
 * `undefined`: el usuario terminaba viendo «Error» en vez de «el peso está fuera de rango» o «el
 * animal tiene retiro activo». La API sabía exactamente qué pasaba y la pantalla lo tiraba.
 *
 * Duele más donde más apura: en la manga, con guantes, «ERROR AL GUARDAR» no dice qué corregir.
 *
 * Va como helper y no como parche en cada pantalla para que la próxima no vuelva a elegir mal la
 * propiedad. `message` se sigue leyendo al final, por si alguna ruta devuelve el formato de Nest.
 */
export function apiErrorTitle(body: unknown, fallback: string): string {
  const b = body as { title?: unknown; message?: unknown } | null | undefined;
  if (typeof b?.title === 'string' && b.title) return b.title;
  const m = b?.message;
  if (typeof m === 'string' && m) return m;
  const mt = (m as { title?: unknown } | undefined)?.title;
  if (typeof mt === 'string' && mt) return mt;
  return fallback;
}
