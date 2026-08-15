import { newActionToken, hashActionToken } from '../../common/action-token';

/**
 * El token de invitación lleva el tenant ADELANTE del secreto: `<tenantId>.<secreto>`.
 *
 * ## Por qué, si el secreto solo ya alcanzaría
 *
 * Porque `invitations` tiene RLS por tenant, y aceptar una invitación es un flujo `@Public`: quien
 * abre el enlace todavía no tiene sesión, así que no hay `app.tenant_id` que fijar. Buscar la fila
 * por el hash del secreto sin contexto de tenant no devuelve NADA — la policy la esconde.
 *
 * Las alternativas que se descartaron:
 *
 *  · Sacar `invitations` de la RLS. Guarda emails y otorgamientos de rol; es de las últimas tablas
 *    que uno querría sin aislar.
 *  · Una policy bespoke con excepción, como `import_batches`. Funciona, pero cuesta una migración
 *    y agrega una segunda forma de leer la tabla que hay que recordar al auditar.
 *  · Usar la conexión ADMIN. Esa corre las migraciones y es privilegiada a propósito; atender
 *    requests con ella tira abajo la premisa que `role-privileges.ts` protege.
 *
 * Con el prefijo, el flujo público fija `app.tenant_id` con lo que dice el token y RECIÉN AHÍ
 * busca por hash. La RLS sigue haciendo su trabajo: solo se puede leer del tenant que se declara.
 * El id de organización no es un secreto —quien acepta va a pertenecer a esa organización en
 * cuanto termine—, y falsear el prefijo no sirve de nada: el hash del secreto no va a estar en el
 * tenant que se invente.
 */

/** Duración de una invitación. Una semana: cubre a quien la abre recién el fin de semana. */
export const INVITATION_TTL_DAYS = 7;

export interface TokenPartido {
  tenantId: string;
  /** SHA-256 del secreto, que es lo que se guarda en `invitations.token`. */
  secretHash: string;
}

/** Genera el token que viaja en el email y el hash que se guarda. */
export function nuevoTokenDeInvitacion(tenantId: string): { token: string; secretHash: string } {
  const { token: secreto, tokenHash } = newActionToken();
  return { token: `${tenantId}.${secreto}`, secretHash: tokenHash };
}

/**
 * Parte el token recibido. Devuelve `null` si está mal formado — mismo tratamiento que un token
 * inexistente: quien lo manda no se entera de en qué falló.
 *
 * El tenant se valida como UUID ANTES de tocar la base: va directo a `set_config('app.tenant_id')`,
 * y aunque va parametrizado, dejar que cualquier cadena llegue ahí es la clase de hábito que
 * después se copia a un lugar donde sí duele.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function partirToken(token: string): TokenPartido | null {
  const limpio = (token ?? '').trim();
  const corte = limpio.indexOf('.');
  if (corte <= 0) return null;
  const tenantId = limpio.slice(0, corte);
  const secreto = limpio.slice(corte + 1);
  if (!UUID.test(tenantId) || !secreto) return null;
  return { tenantId, secretHash: hashActionToken(secreto) };
}
