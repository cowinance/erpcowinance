import type { NextFunction, Request, Response } from 'express';

/**
 * Origen permitido para CORS.
 *
 * `origin: true` (lo que había) refleja CUALQUIER origen: cualquier sitio web puede llamar a la
 * API desde el navegador de un usuario. Los tokens viajan en cookies `SameSite=Lax` leídas por
 * JS, así que el navegador no las manda solo — pero un XSS en cualquier página deja de estar
 * contenido, y la superficie no tiene por qué ser el internet entero.
 *
 * En producción se exige la lista explícita (`CORS_ORIGINS`, separada por comas). Sin lista, se
 * responde sin cabecera CORS: la API sigue funcionando para clientes que no son navegadores
 * (móvil, curl, server-side de Next) y el navegador bloquea el resto. En desarrollo se refleja
 * el origen para no pelearse con puertos que cambian.
 */
export function resolveCorsOrigin(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const raw = env.CORS_ORIGINS?.trim();
  if (raw) {
    const list = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return env.NODE_ENV === 'production' ? false : true;
}

/**
 * Cabeceras de seguridad. Es una API JSON, no un sitio: no hace falta CSP ni permissions-policy,
 * pero sí impedir el sniffing de tipo, el embebido en iframes y la fuga del referrer.
 *
 * HSTS solo con `FORCE_HTTPS=true`: si se manda sobre HTTP plano en un entorno de prueba, el
 * navegador recuerda el pin y deja el host inaccesible. Es una decisión de despliegue, no un
 * default.
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const hsts = env.FORCE_HTTPS?.trim().toLowerCase() === 'true';
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.removeHeader('X-Powered-By');
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/**
 * ¿Confiar en `X-Forwarded-For`? Detrás de un balanceador hay que hacerlo o TODAS las requests
 * comparten la IP del proxy y el rate limit por IP se vuelve un límite global. Sin proxy, confiar
 * sería dejar que el cliente elija su propia identidad y esquive el límite escribiendo la cabecera.
 * Por eso es explícito: `TRUST_PROXY` = `true` (un salto) o un número de saltos.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): number | false {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return 1;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}
