import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { newActionToken, hashActionToken } from '../../common/action-token';

/**
 * Ciclo de vida de los tokens de acción por email (P1.2, ADR-0011): verificación
 * de email y reset de contraseña. Vive en `identity` — son ciclo de vida de la
 * cuenta/credencial, no de sesión.
 *
 * Garantías:
 * - **Hash en DB:** el token en claro solo se devuelve aquí (para el email); en
 *   `email_action_tokens` queda `sha256(token)`.
 * - **Single-use:** consumir marca `consumed_at` en el mismo UPDATE que valida
 *   (atómico); un segundo intento no encuentra fila.
 * - **Expiración:** el consumo exige `expires_at > now()`.
 * - **Un token vivo por (user, purpose):** emitir supersede los previos.
 * - **Purpose no intercambiable:** un token de `verify_email` no consume como
 *   `password_reset` y viceversa.
 *
 * La tabla no tiene RLS (plano de identidad): los flujos son `@Public`, sin
 * contexto de tenant; la fila lleva su `user_id`.
 */
export type EmailActionPurpose = 'verify_email' | 'password_reset';

/** TTL por propósito (segundos). Verificación tolerante; reset corto por seguridad. */
const TTL_SECONDS: Record<EmailActionPurpose, number> = {
  verify_email: 24 * 3600,
  password_reset: 60 * 60,
};

@Injectable()
export class EmailActionTokenService {
  constructor(private readonly db: DbService) {}

  /**
   * Emite un token nuevo para `(userId, purpose)` e invalida los previos sin
   * consumir del mismo par (un solo token vivo por propósito). Devuelve el token
   * EN CLARO — para ponerlo en el email; en DB solo queda el hash.
   */
  async issue(userId: string, purpose: EmailActionPurpose): Promise<string> {
    const { token, tokenHash } = newActionToken();
    const expiresAt = new Date(Date.now() + TTL_SECONDS[purpose] * 1000).toISOString();
    // Supersede: los tokens vivos anteriores del mismo propósito dejan de servir.
    await this.db.query(
      `UPDATE email_action_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
    await this.db.query(
      `INSERT INTO email_action_tokens (id, user_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), userId, purpose, tokenHash, expiresAt],
    );
    return token;
  }

  /**
   * Consume un token: valida hash + propósito + no expirado + no usado y lo marca
   * usado atómicamente (single-use). Devuelve el `user_id`, o `null` si es inválido.
   */
  async consume(token: string, purpose: EmailActionPurpose): Promise<string | null> {
    const row = await this.db.one<{ user_id: string }>(
      `UPDATE email_action_tokens SET consumed_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashActionToken(token), purpose],
    );
    return row?.user_id ?? null;
  }
}
