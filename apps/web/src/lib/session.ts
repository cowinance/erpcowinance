import type { NextResponse } from 'next/server';

/**
 * Cookies de sesión, escritas SOLO desde el servidor (route handlers).
 *
 * POR QUÉ CAMBIÓ: antes las escribía el navegador con `document.cookie`, lo que las hace legibles
 * por JavaScript por definición. Cualquier XSS en la web —una dependencia comprometida, un campo
 * que se renderiza sin escapar— se llevaba el access token y, peor, el refresh token, que dura 7
 * días y se puede renovar indefinidamente. Con `HttpOnly` el navegador las manda pero ningún
 * script las lee: un XSS puede hacer requests mientras la pestaña está abierta, pero no se lleva
 * la sesión.
 */
export const ACCESS_COOKIE = 'cw_access';
export const REFRESH_COOKIE = 'cw_refresh';

/**
 * Marca NO sensible de "hay sesión", legible por JS. Existe porque la UI necesita saber si hay
 * sesión (mostrar "ir al panel" vs "iniciar sesión") y las cookies reales ya no se pueden leer.
 * No lleva el token ni nada derivado de él: su único valor es `1`.
 */
export const SESSION_FLAG_COOKIE = 'cw_session';

export const REFRESH_MAX_AGE_S = 7 * 24 * 3600;

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * `sameSite: 'lax'` (no `strict`) a propósito: con `strict`, llegar desde el link de un email
 * —verificación, reset— no mandaría la cookie y el usuario vería la pantalla de login pese a
 * tener sesión. `lax` ya bloquea el envío en las requests cross-site que importan (POST).
 */
function baseCookie(secure: boolean) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
}

export function setSessionCookies(res: NextResponse, tokens: SessionTokens, secure: boolean): void {
  res.cookies.set(ACCESS_COOKIE, tokens.access_token, { ...baseCookie(secure), maxAge: tokens.expires_in });
  res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, { ...baseCookie(secure), maxAge: REFRESH_MAX_AGE_S });
  // La marca vive lo que vive el refresh: mientras se pueda renovar, hay sesión.
  res.cookies.set(SESSION_FLAG_COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: REFRESH_MAX_AGE_S,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  for (const nombre of [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE]) {
    res.cookies.set(nombre, '', { path: '/', maxAge: 0 });
  }
}

/** ¿La request llegó por HTTPS? Detrás de un proxy, la pista es `x-forwarded-proto`. */
export function isSecureRequest(headers: Headers, url: string): boolean {
  const proto = headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return url.startsWith('https:');
}
