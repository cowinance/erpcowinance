/**
 * Base de la API SIN intermediarios. La usa SOLO el código de servidor que habla con api-core
 * directamente: los route handlers de `app/api/*`, el middleware, `server-api.ts` y `admin-api.ts`.
 * El navegador nunca la usa — va siempre por el proxy `/api/cw` (ver `API_URL`).
 *
 * ## Por qué `API_INTERNAL_URL` y no solo `NEXT_PUBLIC_API_URL`
 *
 * `NEXT_PUBLIC_*` se **inlinea en el build**, no se lee al arrancar. Para un valor que solo lee el
 * servidor, eso es el mecanismo equivocado y ya costó caro dos veces: reconstruir sin pasar la
 * variable dejó la web apuntando a `localhost` y **rompió el registro en producción**.
 *
 * Hay un segundo problema, más silencioso: al inlinearse, el valor termina DENTRO del JavaScript
 * que se le manda al navegador. Configurar el bucle local correcto (`http://127.0.0.1:3001/v1`)
 * publicaba la topología interna en el bundle, aunque el navegador no la use.
 *
 * `API_INTERNAL_URL` no lleva el prefijo, así que Next NO la inlinea: se lee del entorno del
 * proceso al arrancar. Cambiarla es editar el `.env` y reiniciar — sin rebuild, y sin que pueda
 * quedar horneada mal.
 *
 * `NEXT_PUBLIC_API_URL` se mantiene como respaldo para no romper los despliegues que ya la pasan;
 * si están las dos, gana la interna.
 */
export const DEV_API_URL = 'http://localhost:3001/v1';

/**
 * La regla de precedencia, aparte y pura para poder probarla.
 *
 * **Recibe los VALORES, no el objeto `process.env`, y eso no es un detalle de estilo.** Next
 * reconoce `process.env.LO_QUE_SEA` solo como referencia LITERAL en el código; si acá se pasara
 * `process.env` entero y adentro se hiciera `env.API_INTERNAL_URL`, el bundle del middleware (que
 * corre en el runtime Edge) no tendría de dónde resolverla y quedaría en `undefined` — con lo cual
 * la renovación de sesión al navegar volvería a apuntar a la URL vieja. Se comprobó que la forma
 * literal SÍ se resuelve en runtime, en Edge y en Node; conviene no romperla por prolijidad.
 */
export function resolveDirectApiUrl(interna?: string, publica?: string): string {
  return interna?.trim() || publica?.trim() || DEV_API_URL;
}

export const DIRECT_API_URL = resolveDirectApiUrl(process.env.API_INTERNAL_URL, process.env.NEXT_PUBLIC_API_URL);

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
 * Base que SIEMPRE resuelve el navegador, corra donde corra este código.
 *
 * Existe por una asimetría que `API_URL` no puede cubrir: esa constante contesta «¿desde dónde
 * llamo yo a la API?», y la respuesta cambia según se ejecute en el servidor o en el navegador.
 * Pero una URL que se ESCRIBE EN EL HTML —el `src` de una foto, el `href` de un documento— no la
 * pide quien la construye: la pide el navegador, después. Ahí la pregunta correcta es siempre
 * «¿desde dónde la va a pedir el navegador?», y la respuesta es siempre el proxy del mismo origen.
 */
export const BROWSER_API_URL = '/api/cw';

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

/**
 * URL firmada de un archivo (funciona en `<img>` sin cabecera de auth).
 *
 * **Usa `BROWSER_API_URL` y NO `API_URL`, y esa es toda la corrección de un bug real:** la ficha de
 * un animal es un Server Component, así que `API_URL` resolvía ahí a la URL INTERNA de la API y esa
 * dirección terminaba escrita en el `src` de la foto. El navegador después intentaba buscarla y no
 * llegaba: la foto salía rota justo en la ficha, mientras se veía bien en el listado y en la
 * galería —que son componentes de cliente— y por eso parecía que «la foto está pero no aparece».
 *
 * Con la URL interna apuntando al bucle local (`http://127.0.0.1:3001/v1`, que es lo correcto para
 * que el servidor no salga a internet para hablar consigo mismo) el fallo pasa a ser permanente en
 * producción: ninguna imagen renderizada del lado del servidor cargaría nunca.
 *
 * Lo que sigue: cualquier URL que se ESCRIBA para que la pida el navegador va por acá.
 */
export function fileUrl(ref?: PhotoRef | null): string | null {
  if (!ref?.file_id) return null;
  return `${BROWSER_API_URL}/files/${ref.file_id}/content?t=${ref.token}`;
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
