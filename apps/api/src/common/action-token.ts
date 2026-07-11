import { randomBytes, createHash } from 'crypto';

/**
 * Token de acción por email (verificación de email / reset de contraseña, P1.2).
 *
 * Secreto opaco de alta entropía (256 bits). El valor en claro viaja SOLO en el
 * email; en la base se guarda su HASH (un dump de la DB no da tokens usables).
 * Un secreto aleatorio de 256 bits no necesita un KDF caro tipo scrypt (eso es
 * para contraseñas de baja entropía) — SHA-256 es suficiente y determinista para
 * poder buscar por hash.
 */
export function newActionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashActionToken(token) };
}

/** SHA-256 hex del token (para almacenar y para comparar al consumir). */
export function hashActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
