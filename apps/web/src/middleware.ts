import { NextRequest, NextResponse } from 'next/server';

const ACCESS_COOKIE = 'cw_access';

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

/** Sin sesión → /login. La validez del token la verifica la API (401 → /login). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = !!req.cookies.get(ACCESS_COOKIE)?.value;

  if (!hasSession && !isPublicRoute(pathname)) return NextResponse.redirect(new URL('/login', req.url));
  if (hasSession && AUTHENTICATED_REDIRECT_ROUTES.includes(pathname)) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
