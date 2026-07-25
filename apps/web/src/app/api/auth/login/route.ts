import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { isSecureRequest, setSessionCookies, type SessionTokens } from '@/lib/session';

/**
 * Login del lado del servidor: llama a la API, y las cookies de sesión las fija ACÁ, con
 * `HttpOnly`. El navegador nunca ve los tokens.
 *
 * La respuesta al cliente no lleva los tokens tampoco — solo `{ok:true}`. Devolverlos "por las
 * dudas" anularía todo el punto: quedarían en memoria del JavaScript, que es de donde se los
 * queríamos sacar.
 */
export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };

  let upstream: Response;
  try {
    upstream = await fetch(`${DIRECT_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { code: 'network', title: 'No se pudo conectar con el servidor. Reintentá.' },
      { status: 502 },
    );
  }

  const cuerpo = await upstream.json().catch(() => null);
  if (!upstream.ok) return NextResponse.json(cuerpo ?? { title: 'Credenciales inválidas' }, { status: upstream.status });

  const res = NextResponse.json({ ok: true });
  setSessionCookies(res, cuerpo as SessionTokens, isSecureRequest(req.headers, req.url));
  return res;
}
