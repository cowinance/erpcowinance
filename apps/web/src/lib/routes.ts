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
 * Panel de plataforma (dueño de Cowinance), que NO es parte del ERP.
 *
 * Tiene su propia sesión (`cw_platform`), su propio login y su propio shell: ni el middleware ni el
 * layout raíz pueden tratarlo como una ruta más de la app, porque no tiene organización, ni finca,
 * ni menú de módulos. Se decide por prefijo y en un solo lugar por el mismo motivo que
 * `PUBLIC_ROUTES`: son dos decisiones (¿pide sesión?, ¿dibuja el shell?) que tienen que mirar la
 * misma lista.
 *
 * A FUTURO — `admin.cowinance.com`: mover el panel a su propio host es un cambio acotado
 * justamente por esta separación. Haría falta (a) que la cookie se emita con `domain` del subhost
 * en vez de compartir el del ERP, (b) sumar el origen a `resolveCorsOrigin()` de la API, y (c) que
 * el middleware decida por `host` además de por path. Nada de eso toca el backend, que ya está
 * separado por token y por policy.
 */
export const ADMIN_PREFIX = '/admin';
export const ADMIN_LOGIN_ROUTE = '/admin/login';

export function isAdminRoute(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}

/**
 * Cabecera con la que el middleware le pasa el path al layout raíz. Next no expone el pathname a
 * un layout de servidor —no puede, porque el layout se comparte entre rutas—, y el middleware es
 * el único punto que lo conoce antes de renderizar.
 */
export const PATHNAME_HEADER = 'x-cowinance-pathname';
