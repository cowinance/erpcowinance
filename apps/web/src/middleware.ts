import { NextRequest, NextResponse } from 'next/server';

const ACCESS_COOKIE = 'cw_access';

/** Sin sesión → /login (la validez del token la verifica la API: 401 → /login). */
export function middleware(req: NextRequest) {
  const isLogin = req.nextUrl.pathname === '/login';
  const hasSession = !!req.cookies.get(ACCESS_COOKIE)?.value;
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (hasSession && isLogin) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
