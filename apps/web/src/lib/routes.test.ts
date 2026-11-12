import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOGIN_ROUTE,
  ADMIN_PREFIX,
  AUTHENTICATED_REDIRECT_ROUTES,
  PUBLIC_ROUTES,
  isAdminRoute,
  isPublicRoute,
} from './routes';

/**
 * Las dos preguntas que decide el middleware antes de renderizar nada: ¿esta ruta pide sesión?, y
 * ¿es del panel de plataforma, que tiene su propia puerta?
 *
 * Un error acá no da un 500 que alguien note: deja una pantalla privada abierta sin sesión, o
 * manda a un dueño de finca al login del panel. Son dos funciones de una línea y por eso nunca
 * tuvieron test — y por eso mismo nadie se daría cuenta si alguien cambiara un `includes` por un
 * `startsWith` «para que ande una subruta».
 */
describe('isPublicRoute', () => {
  it('deja pasar las rutas declaradas públicas', () => {
    for (const ruta of PUBLIC_ROUTES) expect(isPublicRoute(ruta), ruta).toBe(true);
  });

  it('todo lo demás pide sesión', () => {
    for (const ruta of ['/', '/animales', '/finanzas', '/configuracion', '/manga']) {
      expect(isPublicRoute(ruta), ruta).toBe(false);
    }
  });

  /**
   * Comparación EXACTA, no por prefijo. Con `startsWith`, `/login/cualquier-cosa` sería pública y
   * cualquier ruta nueva colgada de una pública quedaría sin puerta.
   */
  it('una subruta de una pública NO es pública', () => {
    expect(isPublicRoute('/login/admin')).toBe(false);
    expect(isPublicRoute('/register/paso-2')).toBe(false);
    expect(isPublicRoute('/reset-password/confirmar')).toBe(false);
  });

  it('una ruta que solo EMPIEZA parecido no es pública', () => {
    expect(isPublicRoute('/loginza')).toBe(false);
    expect(isPublicRoute('/registernuevo')).toBe(false);
  });

  it('distingue mayúsculas y la barra final: lo que no está declarado, pide sesión', () => {
    expect(isPublicRoute('/Login')).toBe(false);
    expect(isPublicRoute('/login/')).toBe(false);
    expect(isPublicRoute('')).toBe(false);
  });

  /** Si alguna de estas dejara de ser pública, nadie podría entrar ni recuperar su contraseña. */
  it('las puertas de entrada siguen siendo públicas', () => {
    for (const ruta of ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']) {
      expect(isPublicRoute(ruta), ruta).toBe(true);
    }
  });
});

describe('AUTHENTICATED_REDIRECT_ROUTES', () => {
  /** Quien ya tiene sesión no debería poder volver a login/registro y crear otra cuenta encima. */
  it('son login y registro, y las dos son públicas', () => {
    expect(AUTHENTICATED_REDIRECT_ROUTES).toEqual(['/login', '/register']);
    for (const ruta of AUTHENTICATED_REDIRECT_ROUTES) expect(isPublicRoute(ruta), ruta).toBe(true);
  });
});

describe('isAdminRoute', () => {
  it('el panel y todo lo que cuelga de él', () => {
    expect(isAdminRoute('/admin')).toBe(true);
    expect(isAdminRoute('/admin/login')).toBe(true);
    expect(isAdminRoute('/admin/organizaciones/123')).toBe(true);
  });

  /**
   * El caso que justifica que esto no sea un `startsWith('/admin')` pelado: `/administracion` es
   * una ruta del ERP. Tratada como panel, se la juzgaría con la cookie de plataforma —que el dueño
   * de una finca no tiene— y lo mandaría al login del panel, que no le sirve para nada. Al revés
   * es peor: una ruta del ERP dejaría de pasar por la puerta del ERP.
   */
  it('una ruta del ERP que empieza con «admin» NO es del panel', () => {
    expect(isAdminRoute('/administracion')).toBe(false);
    expect(isAdminRoute('/admin-usuarios')).toBe(false);
    expect(isAdminRoute('/adminis')).toBe(false);
  });

  it('las rutas comunes no son del panel', () => {
    for (const ruta of ['/', '/login', '/animales', '/configuracion/usuarios']) {
      expect(isAdminRoute(ruta), ruta).toBe(false);
    }
  });

  it('el login del panel ES del panel, o el middleware lo mandaría a pedir sesión de finca', () => {
    expect(isAdminRoute(ADMIN_LOGIN_ROUTE)).toBe(true);
    expect(ADMIN_LOGIN_ROUTE.startsWith(ADMIN_PREFIX)).toBe(true);
  });

  /** El panel NO es una ruta pública del ERP: tiene su propia puerta, no la ausencia de puerta. */
  it('ninguna ruta del panel figura entre las públicas del ERP', () => {
    for (const ruta of PUBLIC_ROUTES) expect(isAdminRoute(ruta), ruta).toBe(false);
  });
});
