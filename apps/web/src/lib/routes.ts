/**
 * Rutas accesibles SIN sesión (P1.3.3). `verify-email`/`forgot-password`/
 * `reset-password` implementan su lógica en P1.3.4, pero se permiten desde ya
 * para no volver a tocar el middleware.
 *
 * Vive acá, y no dentro del middleware, porque hay DOS decisiones que dependen de la misma lista:
 * quién puede entrar sin sesión y quién ve el shell de la app (sidebar). Tenerla en un solo lugar
 * es lo que impide que una ruta pública nueva quede protegida en una y con menú en la otra.
 */
export const PUBLIC_ROUTES = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password'];

/** Rutas donde un usuario ya autenticado no debería estar (obtener cuenta/sesión). */
export const AUTHENTICATED_REDIRECT_ROUTES = ['/login', '/register'];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}

/**
 * Cabecera con la que el middleware le pasa el path al layout raíz. Next no expone el pathname a
 * un layout de servidor —no puede, porque el layout se comparte entre rutas—, y el middleware es
 * el único punto que lo conoce antes de renderizar.
 */
export const PATHNAME_HEADER = 'x-cowinance-pathname';
