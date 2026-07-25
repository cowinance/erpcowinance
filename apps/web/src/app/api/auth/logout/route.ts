import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { REFRESH_COOKIE, clearSessionCookies } from '@/lib/session';

/**
 * Cierre de sesión. Borra las cookies del navegador **y** revoca el refresh token en el backend:
 * borrar solo la cookie dejaría vivo un token que dura 7 días, y quien lo hubiera copiado seguiría
 * entrando después de que el usuario "cerró sesión".
 *
 * Si la API no responde, igual se limpian las cookies: la sesión local tiene que terminar sí o sí.
 */
export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    await fetch(`${DIRECT_API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: 'no-store',
    }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
