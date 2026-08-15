import { API_URL } from './api';
import { SESSION_FLAG_COOKIE } from './session';

/**
 * Helpers de sesión del cliente web (P1.3.3): un solo lugar para el login y la normalización de
 * errores. `/login` y `/register` (auto-login) los comparten.
 *
 * Los TOKENS ya no pasan por acá. Antes este módulo los recibía y los escribía con
 * `document.cookie`, lo que los dejaba al alcance de cualquier script. Ahora el login va contra un
 * route handler de Next que llama a la API del lado del servidor y fija las cookies con
 * `HttpOnly`: el navegador nunca ve un token.
 */

/** Título de error legible desde el shape `{code,title}` del backend (con fallback). */
export function readErrorTitle(body: unknown, fallback: string): string {
  const b = body as { title?: string; message?: { title?: string } } | null;
  return b?.title ?? b?.message?.title ?? fallback;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Autentica. La respuesta no trae tokens: las cookies las fijó el servidor con `HttpOnly`.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor. Reintentá.' };
  }
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, error: readErrorTitle(body, 'Credenciales inválidas') };
}

/**
 * ¿Hay sesión? Se mira la marca `cw_session`, que NO es HttpOnly y no lleva nada sensible: su
 * único valor es `1`. Las cookies con los tokens ya no se pueden leer desde JavaScript — que es
 * exactamente el punto.
 */
export function hasSession(): boolean {
  return typeof document !== 'undefined' && new RegExp(`(?:^|; )${SESSION_FLAG_COOKIE}=`).test(document.cookie);
}

/**
 * Cierra la sesión. Va por el servidor porque además de borrar las cookies hay que REVOCAR el
 * refresh token: borrar solo la cookie dejaría vivo, por 7 días, un token que alguien podría tener
 * copiado.
 */
export async function clearSession(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

/**
 * Resultado normalizado de un POST a un endpoint público (verify/forgot/reset/
 * resend). Distingue fallo de red de error HTTP y expone el `code` estructurado
 * del backend (P1.3.4) — las páginas ramifican por `code`, no por texto exacto.
 */
export type PublicPostResult<T = unknown> =
  | { ok: true; data: T | null }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'http'; status: number; code?: string; title?: string };

/**
 * `data` se agregó para la previsualización de invitaciones, que necesita el cuerpo de la
 * respuesta —a qué finca y con qué rol te invitaron— y no solo si salió bien. Es aditivo: los
 * llamadores que solo miran `ok` no se enteran.
 */
export async function postPublic<T = unknown>(path: string, body: unknown): Promise<PublicPostResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (res.ok) return { ok: true, data: ((await res.json().catch(() => null)) as T | null) };
  const data = (await res.json().catch(() => null)) as { code?: string; title?: string } | null;
  return { ok: false, kind: 'http', status: res.status, code: data?.code, title: data?.title };
}
