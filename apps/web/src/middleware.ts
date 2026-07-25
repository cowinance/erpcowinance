import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  isSecureRequest,
  setSessionCookies,
  type SessionTokens,
} from '@/lib/session';

/**
 * Rutas accesibles SIN sesión (P1.3.3). `verify-email`/`forgot-password`/
 * `reset-password` implementan su lógica en P1.3.4, pero se permiten desde ya
 * para no volver a tocar el middleware. Decisión de acceso centralizada aquí —
 * sin comparaciones de strings dispersas por el archivo.
 */
const PUBLIC_ROUTES = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password'];

/** Rutas donde un usuario ya autenticado no debería estar (obtener cuenta/sesión). */
const AUTHENTICATED_REDIRECT_ROUTES = ['/login', '/register'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}

/**
 * Puerta de sesión de la web y —esto es nuevo— el lugar donde el token se RENUEVA al navegar.
 *
 * El access token dura 15 minutos y nada lo renovaba: a los 15 minutos de trabajo, la siguiente
 * navegación mandaba al usuario a /login. Los Server Components no pueden escribir cookies (Next lo
 * prohíbe), así que el único punto del lado del servidor que puede renovar ANTES de que la página
 * se renderice es este. Los `fetch` del navegador los cubre el proxy `app/api/cw`.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (access) return decidir(req, true);

  // Sin access pero con refresh: la sesión sigue viva, solo venció el token corto.
  if (refresh) {
    const tokens = await renovar(refresh);
    if (tokens) {
      const res = decidir(req, true);
      setSessionCookies(res, tokens, isSecureRequest(req.headers, req.url));
      return res;
    }
    // El refresh ya no sirve (vencido, rotado o revocado): se limpian las cookies para no volver a
    // intentarlo en cada navegación.
    const res = decidir(req, false);
    clearSessionCookies(res);
    return res;
  }

  return decidir(req, false);
}

function decidir(req: NextRequest, haySesion: boolean): NextResponse {
  const { pathname } = req.nextUrl;
  if (!haySesion && !isPublicRoute(pathname)) return NextResponse.redirect(new URL('/login', req.url));
  if (haySesion && AUTHENTICATED_REDIRECT_ROUTES.includes(pathname))
    return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

async function renovar(refreshToken: string): Promise<SessionTokens | null> {
  try {
    const res = await fetch(`${DIRECT_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as SessionTokens) : null;
  } catch {
    return null;
  }
}

export const config = {
  // `/api` queda afuera: esos son los route handlers de la propia web (login, logout y el proxy),
  // que ya manejan su sesión. Si el middleware también renovara ahí, dos renovaciones simultáneas
  // usarían el mismo refresh token — y el backend interpreta el reuso como robo y revoca todo.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
