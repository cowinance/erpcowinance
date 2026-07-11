import { API_URL, ACCESS_COOKIE, REFRESH_COOKIE } from './api';

/**
 * Helpers de sesión del cliente web (P1.3.3): un solo lugar para la llamada a
 * /auth/login, la persistencia de tokens en cookies y la normalización de
 * errores. `/login` y `/register` (auto-login) los comparten — sin duplicar la
 * lógica ni crear una abstracción general.
 */
const REFRESH_MAX_AGE_S = 7 * 24 * 3600;

export interface SessionTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

/** Título de error legible desde el shape `{code,title}` del backend (con fallback). */
export function readErrorTitle(body: unknown, fallback: string): string {
  const b = body as { title?: string; message?: { title?: string } } | null;
  return b?.title ?? b?.message?.title ?? fallback;
}

/** Persiste la sesión en cookies (mismo mecanismo que ya usaba /login). */
export function persistSession(t: SessionTokens): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ACCESS_COOKIE}=${encodeURIComponent(t.access_token)}; path=/; max-age=${t.expires_in}; SameSite=Lax${secure}`;
  document.cookie = `${REFRESH_COOKIE}=${encodeURIComponent(t.refresh_token)}; path=/; max-age=${REFRESH_MAX_AGE_S}; SameSite=Lax${secure}`;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Autentica y persiste la sesión. Único punto de login + tokens + errores. */
export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor. Reintentá.' };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: readErrorTitle(body, 'Credenciales inválidas') };
  persistSession(body as SessionTokens);
  return { ok: true };
}

/** ¿Hay sesión web local? (cookie de acceso presente). */
export function hasSession(): boolean {
  return typeof document !== 'undefined' && new RegExp(`(?:^|; )${ACCESS_COOKIE}=`).test(document.cookie);
}

/** Borra la sesión web local (cookies). Tras un reset, el backend revoca todo. */
export function clearSession(): void {
  document.cookie = `${ACCESS_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${REFRESH_COOKIE}=; path=/; max-age=0`;
}

/**
 * Resultado normalizado de un POST a un endpoint público (verify/forgot/reset/
 * resend). Distingue fallo de red de error HTTP y expone el `code` estructurado
 * del backend (P1.3.4) — las páginas ramifican por `code`, no por texto exacto.
 */
export type PublicPostResult =
  | { ok: true }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'http'; status: number; code?: string; title?: string };

export async function postPublic(path: string, body: unknown): Promise<PublicPostResult> {
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
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => null)) as { code?: string; title?: string } | null;
  return { ok: false, kind: 'http', status: res.status, code: data?.code, title: data?.title };
}
