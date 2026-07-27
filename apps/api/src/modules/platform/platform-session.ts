import { createHmac } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../auth/auth.service';

/**
 * Sesión de PLATAFORMA: un token que no es —y no puede confundirse con— un token del ERP.
 *
 * ## Por qué no alcanza con un claim
 *
 * La opción fácil era meter `platform_admin: true` en el access token de siempre y chequearlo en un
 * guard. El problema es que ese token vive en el navegador de la finca, viaja en cada request del
 * ERP, se renueva solo cada 15 minutos y aparece en los logs de cualquier proxy intermedio. Un
 * token filtrado ahí pasaría a valer para el panel global.
 *
 * Acá los dos mundos están separados por la CLAVE, no por un `if`:
 *
 *  · **La clave se deriva** de `JWT_SECRET` con HMAC y una etiqueta fija. Es determinística (no hay
 *    variable nueva que configurar ni que rotar por separado) y distinta: un access token del ERP
 *    NO valida contra ella, y este token NO valida contra la del ERP. Rotar `JWT_SECRET` invalida
 *    las dos cosas a la vez, que es lo que uno espera al rotar.
 *  · **`typ: 'platform'`** y el `AuthInterceptor` ya exige `typ === 'access'`. Con lo cual la
 *    separación es bidireccional aunque alguien se equivoque en un lado.
 *  · **No hay claim `ten`.** No es un olvido: este token no representa acceso a ninguna
 *    organización, así que no hay tenant al que ponerle contexto. Es lo que resuelve el problema
 *    de fondo —un dueño de Cowinance no pertenece a ninguna finca— sin inventarle una.
 *
 * ## Sin refresh token, a propósito
 *
 * El refresh del ERP dura 7 días y se renueva indefinidamente; es la concesión correcta para gente
 * que trabaja en la manga con guantes. Un panel de administración global no tiene esa excusa: la
 * sesión dura 30 minutos y se vuelve a entrar. Además evita duplicar la máquina de rotación y
 * detección de reuso, que es la parte más delicada de `auth`.
 */

export const PLATFORM_JWT_ISSUER = 'cowinance-platform';
export const PLATFORM_TTL_S = 30 * 60;

/** Clave derivada: distinta de JWT_SECRET por construcción, y sin configuración nueva. */
export const PLATFORM_JWT_SECRET = createHmac('sha256', JWT_SECRET).update(PLATFORM_JWT_ISSUER).digest('hex');

export type PlatformRole = 'superadmin' | 'support' | 'billing' | 'auditor';

export const PLATFORM_ROLES: readonly PlatformRole[] = ['superadmin', 'support', 'billing', 'auditor'];

export interface PlatformTokenPayload {
  sub: string;
  prole: PlatformRole;
  /** ¿La sesión satisfizo MFA? Hoy siempre false (no hay TOTP); el guard lo audita. */
  mfa: boolean;
  typ: 'platform';
}

/** Actor de plataforma resuelto por el guard y adjuntado a la request. */
export interface PlatformActor {
  userId: string;
  role: PlatformRole;
  email: string;
  name: string;
  mfa: boolean;
}

export function signPlatformToken(payload: Omit<PlatformTokenPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'platform' }, PLATFORM_JWT_SECRET, {
    issuer: PLATFORM_JWT_ISSUER,
    expiresIn: PLATFORM_TTL_S,
  });
}

/** Verifica y devuelve el payload, o `null` si el token no es una sesión de plataforma válida. */
export function verifyPlatformToken(token: string): PlatformTokenPayload | null {
  try {
    const payload = jwt.verify(token, PLATFORM_JWT_SECRET, { issuer: PLATFORM_JWT_ISSUER }) as PlatformTokenPayload;
    return payload.typ === 'platform' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * ¿Se exige MFA para entrar al panel?
 *
 * Apagado por defecto porque todavía no existe el flujo TOTP: prenderlo hoy dejaría a todos los
 * administradores afuera. La estructura ya está (`platform_admins.mfa_required` +
 * `users.mfa_enabled`), así que el día que exista el segundo factor esto es una variable de
 * entorno, no una migración.
 */
export function mfaEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.PLATFORM_MFA_ENFORCED?.trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(flag ?? '');
}
