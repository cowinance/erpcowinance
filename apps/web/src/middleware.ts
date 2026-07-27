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
import { PLATFORM_COOKIE } from '@/lib/admin-session';
import { ADMIN_LOGIN_ROUTE, AUTHENTICATED_REDIRECT_ROUTES, PATHNAME_HEADER, isAdminRoute, isPublicRoute } from '@/lib/routes';

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

  // El panel de plataforma tiene su PROPIA puerta y se decide antes que nada: si cayera en la
  // lógica de abajo, un dueño de Cowinance sin sesión de finca terminaría en `/login` —el login
  // del ERP— que no le sirve para nada, y peor: uno CON sesión de finca entraría a `/admin` sin
  // ser administrador de plataforma. La autorización de verdad la hace el backend; esto es solo
  // para no mostrar una pantalla que va a fallar.
  if (isAdminRoute(pathname)) {
    const platform = req.cookies.get(PLATFORM_COOKIE)?.value;
    if (!platform && pathname !== ADMIN_LOGIN_ROUTE)
      return NextResponse.redirect(new URL(ADMIN_LOGIN_ROUTE, req.url));
    return NextResponse.next({ request: { headers: conPathname(req) } });
  }

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

  return NextResponse.next({ request: { headers: conPathname(req) } });
}

/**
 * El path viaja al layout raíz para que decida si dibuja el shell de la app. Es la única forma de
 * que un layout de servidor sepa en qué ruta está: Next no se lo pasa, porque el layout se comparte
 * entre rutas y volverlo dependiente del path rompería su cacheo.
 */
function conPathname(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  headers.set(PATHNAME_HEADER, req.nextUrl.pathname);
  return headers;
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
