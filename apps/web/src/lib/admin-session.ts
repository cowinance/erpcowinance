import type { NextResponse } from 'next/server';

/**
 * Sesión del panel de plataforma (`/admin`), separada de la del ERP.
 *
 * Cookie DISTINTA de `cw_access` a propósito, no por prolijidad: son dos identidades con dos
 * alcances distintos y el backend las firma con claves distintas. Compartir la cookie obligaría a
 * que un mismo token sirviera para las dos cosas, que es exactamente lo que el diseño del backend
 * evita.
 *
 * No hay refresh: la sesión de plataforma dura 30 minutos y se vuelve a entrar. Es la contrapartida
 * correcta de un panel que ve todas las fincas.
 */
export const PLATFORM_COOKIE = 'cw_platform';

/**
 * Marca NO sensible de «hay sesión de plataforma», legible por JS. Mismo rol que `cw_session` en el
 * ERP: la cookie real es `HttpOnly` y la UI necesita saber si mostrar el panel o el login.
 */
export const PLATFORM_FLAG_COOKIE = 'cw_platform_on';

export interface PlatformTokens {
  access_token: string;
  expires_in: number;
}

export function setPlatformCookie(res: NextResponse, tokens: PlatformTokens, secure: boolean): void {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  res.cookies.set(PLATFORM_COOKIE, tokens.access_token, { ...base, maxAge: tokens.expires_in });
  res.cookies.set(PLATFORM_FLAG_COOKIE, '1', { ...base, httpOnly: false, maxAge: tokens.expires_in });
}

export function clearPlatformCookie(res: NextResponse): void {
  for (const nombre of [PLATFORM_COOKIE, PLATFORM_FLAG_COOKIE]) res.cookies.set(nombre, '', { path: '/', maxAge: 0 });
}
