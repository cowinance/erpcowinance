import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { ACCESS_COOKIE, isSecureRequest, setSessionCookies, type SessionTokens } from '@/lib/session';

/**
 * Cambiar de organización, del lado del servidor — mismo motivo que el login.
 *
 * El cambio devuelve un par de tokens NUEVO, y las cookies de sesión son `HttpOnly`: el navegador
 * no puede escribirlas. Si esto se hiciera desde el cliente, la API tendría que devolverle los
 * tokens al JavaScript, que es exactamente de donde se los sacó al ponerlos en cookies.
 *
 * La respuesta al cliente tampoco los lleva: solo `{ok:true}`. Quien la llama recarga y ya está
 * en la otra finca.
 */
export async function POST(req: NextRequest) {
  const { organization_id } = (await req.json().catch(() => ({}))) as { organization_id?: string };
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!access) return NextResponse.json({ code: 'auth.no_session', title: 'No hay sesión' }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${DIRECT_API_URL}/auth/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({ organization_id }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { code: 'network', title: 'No se pudo conectar con el servidor. Reintentá.' },
      { status: 502 },
    );
  }

  const cuerpo = await upstream.json().catch(() => null);
  if (!upstream.ok)
    return NextResponse.json(cuerpo ?? { title: 'No se pudo cambiar de organización' }, { status: upstream.status });

  const res = NextResponse.json({ ok: true });
  setSessionCookies(res, cuerpo as SessionTokens, isSecureRequest(req.headers, req.url));
  return res;
}
