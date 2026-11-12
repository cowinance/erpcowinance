import { describe, expect, it } from 'vitest';
import type { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_S,
  SESSION_FLAG_COOKIE,
  clearSessionCookies,
  isSecureRequest,
  setSessionCookies,
} from './session';

/**
 * Las cookies de sesión de la web.
 *
 * Esto existe porque antes las escribía el navegador con `document.cookie`, lo que las hace
 * legibles por cualquier script: un XSS se llevaba el refresh token, que dura siete días y se
 * renueva indefinidamente. La propiedad que hay que defender es sencilla de decir y fácil de
 * romper sin darse cuenta: **los tokens van `httpOnly`, la marca que JavaScript sí puede leer no
 * lleva nada derivado de ellos**.
 */

/** Respuesta de mentira que anota lo que se le escribe. */
function respuesta() {
  const puestas: { nombre: string; valor: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookies: { set: (nombre: string, valor: string, opts: Record<string, unknown>) => puestas.push({ nombre, valor, opts }) },
  } as unknown as NextResponse;
  return { res, puestas, buscar: (n: string) => puestas.find((p) => p.nombre === n) };
}

const TOKENS = { access_token: 'acc-123', refresh_token: 'ref-456', expires_in: 900 };

describe('setSessionCookies', () => {
  it('escribe las tres cookies', () => {
    const { res, puestas } = respuesta();
    setSessionCookies(res, TOKENS, true);
    expect(puestas.map((p) => p.nombre)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE]);
  });

  /** La propiedad central: ningún script puede leer los tokens. */
  it('los dos tokens son httpOnly', () => {
    const { res, buscar } = respuesta();
    setSessionCookies(res, TOKENS, true);
    expect(buscar(ACCESS_COOKIE)!.opts.httpOnly).toBe(true);
    expect(buscar(REFRESH_COOKIE)!.opts.httpOnly).toBe(true);
  });

  /**
   * La marca SÍ la lee JavaScript —la UI necesita saber si mostrar «ir al panel» o «iniciar
   * sesión»— y justamente por eso no puede llevar nada del token. Su único valor es `1`.
   */
  it('la marca legible por JS no contiene ningún token', () => {
    const { res, buscar } = respuesta();
    setSessionCookies(res, TOKENS, true);
    const marca = buscar(SESSION_FLAG_COOKIE)!;
    expect(marca.opts.httpOnly).toBe(false);
    expect(marca.valor).toBe('1');
    expect(marca.valor).not.toContain(TOKENS.access_token);
    expect(marca.valor).not.toContain(TOKENS.refresh_token);
  });

  it('cada cookie lleva el token que le corresponde', () => {
    const { res, buscar } = respuesta();
    setSessionCookies(res, TOKENS, true);
    expect(buscar(ACCESS_COOKIE)!.valor).toBe('acc-123');
    expect(buscar(REFRESH_COOKIE)!.valor).toBe('ref-456');
  });

  /** El access vive lo que dice el servidor; la sesión, lo que se pueda renovar. */
  it('las vigencias salen del token corto y del refresh, no de un número fijo', () => {
    const { res, buscar } = respuesta();
    setSessionCookies(res, { ...TOKENS, expires_in: 1234 }, true);
    expect(buscar(ACCESS_COOKIE)!.opts.maxAge).toBe(1234);
    expect(buscar(REFRESH_COOKIE)!.opts.maxAge).toBe(REFRESH_MAX_AGE_S);
    expect(buscar(SESSION_FLAG_COOKIE)!.opts.maxAge).toBe(REFRESH_MAX_AGE_S);
  });

  /** Si `secure` no viajara, en producción los tokens saldrían también por http. */
  it('`secure` llega a las tres', () => {
    for (const seguro of [true, false]) {
      const { res, puestas } = respuesta();
      setSessionCookies(res, TOKENS, seguro);
      for (const p of puestas) expect(p.opts.secure, `${p.nombre} secure=${seguro}`).toBe(seguro);
    }
  });

  /**
   * `lax` y no `strict`: con `strict`, llegar desde el enlace de un email no mandaría la cookie y
   * la persona vería el login teniendo sesión.
   */
  it('todas van sameSite lax y con path raíz', () => {
    const { res, puestas } = respuesta();
    setSessionCookies(res, TOKENS, true);
    for (const p of puestas) {
      expect(p.opts.sameSite, p.nombre).toBe('lax');
      expect(p.opts.path, p.nombre).toBe('/');
    }
  });
});

describe('clearSessionCookies', () => {
  /** Si quedara una sola viva, el middleware intentaría renovar en cada navegación. */
  it('borra las tres, no solo los tokens', () => {
    const { res, puestas } = respuesta();
    clearSessionCookies(res);
    expect(puestas.map((p) => p.nombre).sort()).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE].sort());
    for (const p of puestas) {
      expect(p.valor, p.nombre).toBe('');
      expect(p.opts.maxAge, p.nombre).toBe(0);
      expect(p.opts.path, p.nombre).toBe('/');
    }
  });
});

describe('isSecureRequest', () => {
  const h = (valores: Record<string, string> = {}) => new Headers(valores);

  it('sin proxy, decide la URL', () => {
    expect(isSecureRequest(h(), 'https://cowinance.com/animales')).toBe(true);
    expect(isSecureRequest(h(), 'http://localhost:3000/animales')).toBe(false);
  });

  /** Detrás de un balanceador la URL interna es http: la pista verdadera es la cabecera. */
  it('la cabecera del proxy manda sobre la URL', () => {
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'https' }), 'http://interno:3000/')).toBe(true);
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'http' }), 'https://cowinance.com/')).toBe(false);
  });

  /** Con varios proxies encadenados la cabecera trae una lista; el primero es el del cliente. */
  it('con una cadena de proxies toma el primer protocolo', () => {
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'https,http' }), 'http://interno/')).toBe(true);
    expect(isSecureRequest(h({ 'x-forwarded-proto': ' https , http ' }), 'http://interno/')).toBe(true);
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'http,https' }), 'http://interno/')).toBe(false);
  });

  it('una cabecera rara no se toma por segura', () => {
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'HTTPS' }), 'http://interno/')).toBe(false);
    expect(isSecureRequest(h({ 'x-forwarded-proto': 'wss' }), 'http://interno/')).toBe(false);
  });
});
