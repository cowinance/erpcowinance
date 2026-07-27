import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { PLATFORM_COOKIE } from '@/lib/admin-session';
import { ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE, isSecureRequest } from '@/lib/session';

/**
 * Entrar en MODO ESPEJO: pide la sesión de 10 minutos al panel y la deja como cookie del ERP.
 *
 * ## Por qué pasa por acá y no desde el navegador
 *
 * El token de espejo es una sesión sobre la finca de un cliente. Igual que el resto de las
 * sesiones, se guarda `HttpOnly`: el JavaScript de la página nunca lo ve, así que un XSS no se lo
 * lleva. La respuesta al cliente es `{ok:true}` y nada más.
 *
 * ## El detalle que hay que decirle a la persona
 *
 * Esto PISA la sesión del ERP que tuviera abierta. Quien da soporte y además usa Cowinance para su
 * propia finca va a tener que volver a entrar cuando salga del espejo. Se avisa en el diálogo de
 * confirmación; acá se deja explícito para que nadie lo tome por un bug.
 *
 * NO se toca la cookie de plataforma: sigue viva en paralelo, y es la que permite volver al panel y
 * registrar el cierre de la sesión de espejo.
 */
export async function POST(req: NextRequest) {
  const plataforma = req.cookies.get(PLATFORM_COOKIE)?.value;
  if (!plataforma) return NextResponse.json({ title: 'Sesión de plataforma requerida' }, { status: 401 });

  const { user_id, reason } = (await req.json().catch(() => ({}))) as { user_id?: string; reason?: string };
  if (!user_id) return NextResponse.json({ title: 'Falta el usuario' }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(`${DIRECT_API_URL}/platform/users/${user_id}/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${plataforma}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ title: 'No se pudo conectar con el servidor.' }, { status: 502 });
  }

  const cuerpo = await upstream.json().catch(() => null);
  if (!upstream.ok) return NextResponse.json(cuerpo ?? { title: 'No se pudo entrar' }, { status: upstream.status });

  const seguro = isSecureRequest(req.headers, req.url);
  const res = NextResponse.json({
    ok: true,
    sid: cuerpo.sid,
    organization: cuerpo.organization?.name,
    user: cuerpo.user?.email,
  });

  res.cookies.set(ACCESS_COOKIE, cuerpo.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: seguro,
    path: '/',
    maxAge: cuerpo.expires_in,
  });
  // SIN refresh: la sesión de espejo no se renueva. A los 10 minutos se termina y hay que volver a
  // pedirla, lo que deja otra entrada en la bitácora. Se BORRA el refresh que hubiera de la sesión
  // anterior: si quedara, al vencer el token de espejo el middleware lo usaría para renovar y la
  // persona volvería a su propia sesión sin darse cuenta de que salió del espejo.
  res.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(SESSION_FLAG_COOKIE, '1', { httpOnly: false, sameSite: 'lax', secure: seguro, path: '/', maxAge: cuerpo.expires_in });
  return res;
}
