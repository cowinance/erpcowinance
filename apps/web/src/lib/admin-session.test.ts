import { describe, expect, it } from 'vitest';
import type { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE } from './session';
import {
  PLATFORM_COOKIE,
  PLATFORM_FLAG_COOKIE,
  clearPlatformCookie,
  setPlatformCookie,
} from './admin-session';

/**
 * La sesión del panel de plataforma, que ve TODAS las fincas.
 *
 * Está separada de la del ERP a propósito: son dos identidades con alcances distintos y el backend
 * las firma con claves distintas. Lo que se prueba acá es que esa separación siga siendo real —
 * que las cookies no se pisen— y que el token no quede legible por JavaScript, que en un panel con
 * este alcance es peor que en el ERP.
 */
function respuesta() {
  const puestas: { nombre: string; valor: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookies: { set: (nombre: string, valor: string, opts: Record<string, unknown>) => puestas.push({ nombre, valor, opts }) },
  } as unknown as NextResponse;
  return { res, puestas, buscar: (n: string) => puestas.find((p) => p.nombre === n) };
}

const TOKENS = { access_token: 'plat-abc', expires_in: 1800 };

describe('setPlatformCookie', () => {
  it('escribe el token y la marca', () => {
    const { res, puestas } = respuesta();
    setPlatformCookie(res, TOKENS, true);
    expect(puestas.map((p) => p.nombre)).toEqual([PLATFORM_COOKIE, PLATFORM_FLAG_COOKIE]);
  });

  it('el token va httpOnly y la marca no lleva nada derivado de él', () => {
    const { res, buscar } = respuesta();
    setPlatformCookie(res, TOKENS, true);
    expect(buscar(PLATFORM_COOKIE)!.opts.httpOnly).toBe(true);
    expect(buscar(PLATFORM_COOKIE)!.valor).toBe('plat-abc');
    const marca = buscar(PLATFORM_FLAG_COOKIE)!;
    expect(marca.opts.httpOnly).toBe(false);
    expect(marca.valor).toBe('1');
    expect(marca.valor).not.toContain(TOKENS.access_token);
  });

  /** Sin refresh: la sesión del panel dura lo que dura su token y se vuelve a entrar. */
  it('las dos viven lo que dice el servidor, no un plazo propio', () => {
    const { res, buscar } = respuesta();
    setPlatformCookie(res, { access_token: 'x', expires_in: 1800 }, true);
    expect(buscar(PLATFORM_COOKIE)!.opts.maxAge).toBe(1800);
    expect(buscar(PLATFORM_FLAG_COOKIE)!.opts.maxAge).toBe(1800);
  });

  it('`secure` llega a las dos', () => {
    for (const seguro of [true, false]) {
      const { res, puestas } = respuesta();
      setPlatformCookie(res, TOKENS, seguro);
      for (const p of puestas) expect(p.opts.secure, `${p.nombre} secure=${seguro}`).toBe(seguro);
    }
  });
});

describe('clearPlatformCookie', () => {
  it('borra el token y la marca', () => {
    const { res, puestas } = respuesta();
    clearPlatformCookie(res);
    expect(puestas.map((p) => p.nombre).sort()).toEqual([PLATFORM_COOKIE, PLATFORM_FLAG_COOKIE].sort());
    for (const p of puestas) {
      expect(p.valor, p.nombre).toBe('');
      expect(p.opts.maxAge, p.nombre).toBe(0);
    }
  });
});

/**
 * El invariante que sostiene toda la separación: si un nombre coincidiera, entrar al panel
 * pisaría la sesión de la finca —o al revés— y las dos identidades se mezclarían en el navegador.
 */
describe('separación de las dos sesiones', () => {
  it('ninguna cookie del panel comparte nombre con las del ERP', () => {
    const erp = [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE];
    for (const nombre of [PLATFORM_COOKIE, PLATFORM_FLAG_COOKIE]) expect(erp, nombre).not.toContain(nombre);
  });

  it('cerrar el panel no toca las cookies del ERP', () => {
    const { res, puestas } = respuesta();
    clearPlatformCookie(res);
    for (const p of puestas) expect([ACCESS_COOKIE, REFRESH_COOKIE, SESSION_FLAG_COOKIE]).not.toContain(p.nombre);
  });
});
