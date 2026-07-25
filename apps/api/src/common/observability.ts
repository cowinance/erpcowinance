import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { metrics } from './metrics';

/**
 * Contexto de OBSERVABILIDAD de la request, separado de `requestContext` (el de auth) a propósito:
 * este se establece ANTES de autenticar, así que existe también en las rutas públicas y en las
 * requests que terminan en 401 — que son justamente las que más hace falta poder rastrear.
 *
 * `tenantId`/`userId` los completa el interceptor de auth cuando resuelve el token. Se guardan acá
 * —y no se leen de `requestContext`— porque el log de acceso se emite en el evento `finish` de la
 * respuesta, cuando la transacción de la request (y con ella su contexto de auth) ya se cerró.
 */
export interface ObservabilityContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  tenantId?: string;
  userId?: string;
}

export const observabilityContext = new AsyncLocalStorage<ObservabilityContext>();

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Un id por request, propagado en la respuesta. Si el cliente (o el balanceador) ya mandó uno, se
 * respeta: así una traza cruza el borde entre la web, la API y el proxy en vez de cortarse en cada
 * salto. Se sanea antes de aceptarlo — el valor viene de afuera y termina en los logs.
 */
export function resolveRequestId(header: unknown): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return randomUUID();
  const limpio = raw.trim().slice(0, 64).replace(/[^\w.:-]/g, '');
  return limpio.length >= 8 ? limpio : randomUUID();
}

/**
 * Etiqueta de ruta para las MÉTRICAS: el patrón, nunca la URL. `/animals/9af0…` como etiqueta
 * crearía una serie de métricas por animal, y en una finca de 10.000 el registro pesaría más que
 * los datos. Express deja el patrón en `req.route.path` una vez que resolvió el routing.
 */
export function routeLabel(req: { route?: { path?: string }; baseUrl?: string }): string {
  const patron = req.route?.path;
  if (!patron) return 'sin_ruta'; // 404 y errores antes del routing
  return `${req.baseUrl ?? ''}${patron}` || patron;
}

/**
 * Middleware de observabilidad: abre el contexto, devuelve el `request_id` y —al terminar la
 * respuesta— emite el log de acceso y registra la métrica.
 *
 * Va como MIDDLEWARE y no como interceptor a propósito. Un interceptor global no llega a correr
 * cuando otro interceptor lanza antes (el de auth, en cada 401): justo las requests que más
 * importa ver quedaban sin registrar. El middleware corre siempre, y `finish` ocurre exactamente
 * una vez, con el código de estado ya definitivo.
 */
export function requestObservability() {
  const logger = new Logger('http');

  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const ctx: ObservabilityContext = {
      requestId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      startedAt: Date.now(),
    };

    observabilityContext.run(ctx, () => {
      res.once('finish', () => {
        const durationMs = Date.now() - ctx.startedAt;
        const status = res.statusCode;
        metrics.observe({ route: routeLabel(req), method: req.method, status, durationMs });

        const linea = `${req.method} ${ctx.path} ${status} ${durationMs}ms`;
        // 5xx a error, 4xx a warn: así un recolector puede alertar sobre fallas del servidor sin
        // ahogarse en los 401 normales de un cliente sin token.
        if (status >= 500) logger.error(linea);
        else if (status >= 400) logger.warn(linea);
        else logger.log(linea);
      });
      next();
    });
  };
}

/** El id de la request en curso, si hay una. Para enriquecer logs desde cualquier capa. */
export function currentRequestId(): string | undefined {
  return observabilityContext.getStore()?.requestId;
}

/** El interceptor de auth lo llama al resolver el token, para que el log de acceso lleve tenant. */
export function tagActor(tenantId: string, userId: string): void {
  const ctx = observabilityContext.getStore();
  if (ctx) {
    ctx.tenantId = tenantId;
    ctx.userId = userId;
  }
}
