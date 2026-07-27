import { NextRequest, NextResponse } from 'next/server';
import { clearPlatformCookie } from '@/lib/admin-session';

/**
 * Cierre de sesión del panel: borrar la cookie ALCANZA.
 *
 * No hay nada que revocar del lado del servidor porque no hay refresh token que revocar (la sesión
 * de plataforma dura 30 minutos y se acabó). El `POST` es a propósito: un `GET` sería disparable
 * desde un `<img>` de cualquier página y cerraría la sesión sin que el operador lo pidiera.
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 });
  clearPlatformCookie(res);
  return res;
}
