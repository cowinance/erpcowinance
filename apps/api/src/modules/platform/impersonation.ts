import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { JWT_ISSUER, JWT_SECRET } from '../auth/auth.service';
import type { PlatformRole } from './platform-session';

/**
 * MODO ESPEJO — entrar como un usuario de finca para dar soporte.
 *
 * Es la capacidad más peligrosa del sistema: quien la usa ve TODO lo de esa finca. Por eso las
 * cuatro restricciones no son opcionales y ninguna depende de que el código se porte bien.
 *
 * ## 1. Es un token del ERP, y tiene que serlo
 *
 * A diferencia del token de plataforma —que se firma con una clave derivada justamente para que NO
 * valga en el ERP—, éste sí se firma con `JWT_SECRET`: es una sesión del ERP y el interceptor de
 * siempre tiene que aceptarla. Lo que lo distingue es `typ: 'impersonation'`, que el interceptor
 * mira para tratarlo distinto.
 *
 * ## 2. Solo lectura, impuesta por PostgreSQL
 *
 * `AuthInterceptor` marca la transacción como READ ONLY. No es un `if` por endpoint: es el motor.
 * Cualquier INSERT/UPDATE/DELETE falla con `25006`, venga de donde venga.
 *
 * **Y hacía falta que fuera así**, porque en este sistema hay varios `GET` que ESCRIBEN: las
 * alertas se evalúan read-through, el contador de notificaciones genera su ledger si falta, y
 * `/billing/subscription` crea el trial la primera vez. Un guard que bloqueara «los métodos que no
 * son GET» habría dejado pasar todas esas escrituras creyendo que bloqueaba las escrituras.
 *
 * ## 3. Dura poco
 *
 * 10 minutos y no se renueva. Un token de soporte que dura lo que una sesión normal es una llave
 * maestra con fecha de vencimiento lejana.
 *
 * ## 4. No se disfraza de la persona
 *
 * El claim `imp` viaja con quién está adentro. El log de acceso y la ficha de sesión lo muestran,
 * así que una acción hecha en modo espejo nunca parece hecha por el cliente.
 */

/** 10 minutos. Deliberadamente incómodo: si hace falta más, se vuelve a entrar y queda registrado. */
export const IMPERSONATION_TTL_S = 10 * 60;

export interface ImpersonationClaim {
  /** Id del administrador de plataforma que está adentro. */
  by: string;
  by_email: string;
  by_role: PlatformRole;
  /** Id de la sesión de espejo: ata el inicio, los accesos y el cierre en la bitácora. */
  sid: string;
}

export interface ImpersonationPayload {
  sub: string;
  ten: string;
  role: string;
  name: string;
  email: string;
  typ: 'impersonation';
  imp: ImpersonationClaim;
}

export function signImpersonationToken(
  user: { id: string; full_name: string; email: string },
  tenantId: string,
  role: string,
  by: Omit<ImpersonationClaim, 'sid'>,
): { token: string; sid: string; expires_in: number } {
  const sid = randomUUID();
  const payload: ImpersonationPayload = {
    sub: user.id,
    ten: tenantId,
    role,
    name: user.full_name,
    email: user.email,
    typ: 'impersonation',
    imp: { ...by, sid },
  };
  return {
    token: jwt.sign(payload, JWT_SECRET, { issuer: JWT_ISSUER, expiresIn: IMPERSONATION_TTL_S }),
    sid,
    expires_in: IMPERSONATION_TTL_S,
  };
}

/**
 * Lee el claim `imp` de un token ya verificado.
 *
 * Se separa de la verificación a propósito: quien verifica es el `AuthInterceptor`, con la misma
 * clave y el mismo emisor que cualquier token del ERP. Acá solo se interpreta el resultado.
 */
export function impersonationOf(payload: { typ?: string; imp?: ImpersonationClaim }): ImpersonationClaim | null {
  return payload?.typ === 'impersonation' && payload.imp?.by ? payload.imp : null;
}
