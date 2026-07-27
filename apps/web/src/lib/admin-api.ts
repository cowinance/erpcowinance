import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DIRECT_API_URL } from './api';
import { PLATFORM_COOKIE } from './admin-session';

/**
 * Fetch al panel de plataforma desde Server Components.
 *
 * TODAS las pantallas de `/admin` se renderizan en el servidor y los filtros viajan por la URL. No
 * es una limitación: evita tener que exponer un proxy `/api/...` para el token de plataforma —el
 * navegador nunca lo ve, ni siquiera indirectamente— y de paso los filtros quedan compartibles y
 * navegables con el historial del browser.
 */
export async function adminApi<T = any>(path: string): Promise<T> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) redirect('/admin/login');
  const res = await fetch(`${DIRECT_API_URL}/platform${path}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 401 = sesión vencida (30 min). 403 = ya no es administrador de plataforma. En los dos casos el
  // destino es el login: no hay nada que el panel pueda mostrar.
  if (res.status === 401 || res.status === 403) redirect('/admin/login?expirada=1');
  if (!res.ok) throw new Error(`platform ${res.status}: ${path}`);
  return res.json();
}

/**
 * POST al panel de plataforma (acciones de la fase 2).
 *
 * Devuelve el error en vez de lanzarlo: acá el «no se pudo» es información para la persona que
 * apretó el botón —«la cuenta ya está suspendida», «tu rol no puede hacer esto», «el motivo es
 * obligatorio»— y no un fallo del sistema. Tirar una excepción mostraría la pantalla de error de
 * Next y perdería el motivo, que es justo lo único útil de la respuesta.
 */
export async function adminPost<T = any>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) redirect('/admin/login');
  let res: Response;
  try {
    res = await fetch(`${DIRECT_API_URL}/platform${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor. Reintentá.' };
  }
  if (res.status === 401) redirect('/admin/login?expirada=1');
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: cuerpo?.title ?? `Error ${res.status}` };
  return { ok: true, data: cuerpo as T };
}

/** `?a=1&b=` → `?a=1` (los filtros vacíos no se mandan). */
export function queryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Bytes → «1,4 GB». El backend manda bigint como TEXTO (puede pasarse del entero seguro de JS). */
export function formatBytes(bytes: string | number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  const v = n / 1024 ** i;
  return `${v.toLocaleString('es', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${u[i]}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
