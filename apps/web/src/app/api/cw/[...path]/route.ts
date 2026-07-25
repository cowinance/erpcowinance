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

/**
 * Proxy de la API para el NAVEGADOR.
 *
 * Existe por una razón concreta: con las cookies en `HttpOnly`, el JavaScript de la página ya no
 * puede leer el token para armar el `Authorization`. En vez de reescribir los ~200 llamados que
 * hay repartidos por la app, todos siguen usando `fetch` como siempre —contra su propio origen— y
 * este handler pone la cabecera del lado del servidor, donde la cookie sí se lee.
 *
 * Dos efectos que no son secundarios:
 *  · El navegador deja de hablar con la API directamente, así que la web ya no necesita CORS.
 *  · Aparece el lugar natural para RENOVAR el token, que es lo que se hace más abajo.
 */

export const dynamic = 'force-dynamic';

/**
 * Renovaciones en curso, por refresh token.
 *
 * El backend rota el refresh en cada uso y REVOCA LA SESIÓN ENTERA si detecta reuso (protección
 * contra robo, ADR-0011). Una pantalla que dispara cinco requests en paralelo justo cuando venció
 * el access token intentaría renovar cinco veces con el mismo refresh: la primera rota, las otras
 * cuatro parecen un robo y el usuario queda afuera. Compartir la promesa hace que las cinco
 * esperen la MISMA renovación.
 */
const renovacionesEnCurso = new Map<string, Promise<SessionTokens | null>>();

async function renovar(refreshToken: string): Promise<SessionTokens | null> {
  const enCurso = renovacionesEnCurso.get(refreshToken);
  if (enCurso) return enCurso;

  const promesa = (async () => {
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
    } finally {
      // Se libera en el próximo tick para que las requests que llegaron mientras corría alcancen
      // a engancharse a esta promesa en vez de arrancar otra.
      setTimeout(() => renovacionesEnCurso.delete(refreshToken), 0);
    }
  })();

  renovacionesEnCurso.set(refreshToken, promesa);
  return promesa;
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await ctx.params;
  const destino = `${DIRECT_API_URL}/${path.join('/')}${req.nextUrl.search}`;

  // El cuerpo se lee UNA vez y se guarda: si hay que reintentar tras renovar, no se puede volver
  // a leer el stream de la request original.
  const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  const enviar = (token?: string) =>
    fetch(destino, {
      method: req.method,
      headers: {
        ...(req.headers.get('content-type') ? { 'Content-Type': req.headers.get('content-type')! } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Propaga la traza: el log de la API va a mostrar el mismo request_id que el de la web.
        ...(req.headers.get('x-request-id') ? { 'X-Request-Id': req.headers.get('x-request-id')! } : {}),
      },
      body: cuerpo,
      cache: 'no-store',
    });

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  let upstream = await enviar(access);
  let renovados: SessionTokens | null = null;

  // 401 con refresh disponible → renovar y reintentar UNA vez. Esto es lo que hace que una sesión
  // dure de verdad: el access token vive 15 minutos, y hasta ahora nada lo renovaba — el usuario
  // terminaba en /login en medio del trabajo.
  if (upstream.status === 401) {
    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    if (refresh) {
      renovados = await renovar(refresh);
      if (renovados) upstream = await enviar(renovados.access_token);
    }
  }

  const res = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: cabecerasSeguras(upstream.headers),
  });

  const secure = isSecureRequest(req.headers, req.url);
  if (renovados) setSessionCookies(res, renovados, secure);
  // Sigue en 401 después de intentar renovar: la sesión no se recupera. Se limpian las cookies
  // para que el middleware mande a /login en la próxima navegación, en vez de dejar al usuario
  // dando vueltas con una sesión muerta.
  else if (upstream.status === 401) clearSessionCookies(res);

  return res;
}

/**
 * Solo se copian las cabeceras que el navegador necesita. En particular NO se propaga
 * `set-cookie` de la API: las cookies de sesión las decide este proxy, y reenviar las de arriba
 * sería darle a un upstream la capacidad de escribir en el dominio de la web.
 */
function cabecerasSeguras(origen: Headers): Headers {
  const salida = new Headers();
  for (const nombre of ['content-type', 'content-length', 'cache-control', 'x-request-id', 'retry-after']) {
    const valor = origen.get(nombre);
    if (valor) salida.set(nombre, valor);
  }
  return salida;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
