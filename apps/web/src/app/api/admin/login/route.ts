import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { isSecureRequest } from '@/lib/session';
import { setPlatformCookie, type PlatformTokens } from '@/lib/admin-session';

/**
 * Login del panel de plataforma. Mismo patrón que `/api/auth/login`: el token se fija del lado del
 * servidor en una cookie `HttpOnly` y la respuesta al navegador es `{ok:true}` a secas.
 *
 * Acá importa más que en el ERP: este token ve TODAS las fincas. Que el JavaScript de la página no
 * pueda leerlo significa que un XSS en el panel no se lleva una sesión con acceso global — puede
 * hacer requests mientras la pestaña está abierta, y nada más.
 */
export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };

  let upstream: Response;
  try {
    upstream = await fetch(`${DIRECT_API_URL}/platform/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ code: 'network', title: 'No se pudo conectar con el servidor.' }, { status: 502 });
  }

  const cuerpo = await upstream.json().catch(() => null);
  if (!upstream.ok) return NextResponse.json(cuerpo ?? { title: 'Credenciales inválidas' }, { status: upstream.status });

  const res = NextResponse.json({ ok: true });
  setPlatformCookie(res, cuerpo as PlatformTokens, isSecureRequest(req.headers, req.url));
  return res;
}
