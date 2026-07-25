import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DIRECT_API_URL } from './api';
import { ACCESS_COOKIE } from './session';

/** Fetch autenticado desde Server Components; sin sesión o token vencido → /login. */
export async function api<T = any>(path: string): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/login');
  const res = await fetch(`${DIRECT_API_URL}${path}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/** Igual que api() pero devuelve null si la API no responde (para no romper el layout). */
export async function apiSafe<T = any>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e: any) {
    // los redirects de Next (p. ej. a /login) deben propagarse, no tragarse
    if (typeof e?.digest === 'string' && e.digest.startsWith('NEXT_REDIRECT')) throw e;
    return null;
  }
}
