export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

export const ACCESS_COOKIE = 'cw_access';
export const REFRESH_COOKIE = 'cw_refresh';

/** Cabeceras de auth para fetch desde componentes cliente (lee la cookie). */
export function authHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACCESS_COOKIE}=([^;]*)`));
  return match ? { Authorization: `Bearer ${decodeURIComponent(match[1])}` } : {};
}

export interface PhotoRef {
  file_id: string;
  token: string;
  mime: string;
}

/** URL firmada de un archivo (funciona en <img> sin cabecera de auth). */
export function fileUrl(ref?: PhotoRef | null): string | null {
  if (!ref?.file_id) return null;
  return `${API_URL}/files/${ref.file_id}/content?t=${ref.token}`;
}
