export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

export const ACCESS_COOKIE = 'cw_access';
export const REFRESH_COOKIE = 'cw_refresh';

/** Cabeceras de auth para fetch desde componentes cliente (lee la cookie). */
export function authHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACCESS_COOKIE}=([^;]*)`));
  return match ? { Authorization: `Bearer ${decodeURIComponent(match[1])}` } : {};
}
