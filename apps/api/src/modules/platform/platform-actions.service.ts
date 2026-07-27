import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from './platform.db';
import { AuthService } from '../auth/auth.service';
import { canPerform, validateReason, type PlatformAction } from './platform-permissions';
import type { PlatformActor } from './platform-session';
import type { Q } from '../../db/db.service';

/**
 * Acciones del panel de plataforma — FASE 2.
 *
 * ## Qué entra y qué no
 *
 * Solo cambios de estado REVERSIBLES sobre la cuenta: suspender y reactivar una organización,
 * bloquear y desbloquear a un usuario, cambiar de plan. Nada de impersonation, borrado de usuarios,
 * cambio de email ni pagos — cada una de esas necesita un diseño propio y no un botón (ver el ADR).
 *
 * `billing_payments` sigue con policy `FOR SELECT`: el panel **no puede** tocar dinero aunque
 * alguien agregue el endpoint.
 *
 * ## La parte que no es el botón
 *
 * Antes de esto, `organizations.status` era una columna que no leía NADIE. Suspender habría sido
 * cosmético: la finca seguía trabajando igual. Por eso cada acción acá hace tres cosas juntas y en
 * una sola transacción:
 *
 *   1. cambia el estado,
 *   2. **corta las sesiones vivas** (si no, la suspensión tarda hasta 7 días en notarse, que es lo
 *      que dura un refresh token),
 *   3. deja el motivo en la bitácora.
 *
 * El paso 2 es el que convierte el cambio de columna en una consecuencia real. `auth` hace cumplir
 * el estado en el login y en el refresh (ver `AuthService.assertOrganizationActive`).
 */
@Injectable()
export class PlatformActionsService {
  constructor(private readonly pdb: PlatformDb) {}

  // ── Organizaciones ───────────────────────────────────────────────────────────────────────────

  async suspendOrganization(actor: PlatformActor, id: string, body: { reason?: string }) {
    return this.cambiarEstadoOrg(actor, id, 'suspended', 'organization.suspend', body);
  }

  async reactivateOrganization(actor: PlatformActor, id: string, body: { reason?: string }) {
    return this.cambiarEstadoOrg(actor, id, 'active', 'organization.reactivate', body);
  }

  private async cambiarEstadoOrg(
    actor: PlatformActor,
    id: string,
    destino: 'active' | 'suspended',
    action: PlatformAction,
    body: { reason?: string },
  ) {
    this.assertPuede(actor, action);
    const motivo = this.motivo(body?.reason);

    return this.pdb.write(async (q) => {
      const org = await q.one<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!org) throw new NotFoundException({ code: 'platform.org_not_found', title: 'Organización no encontrada' });

      // Ya estar en el estado destino es un 409 y no un éxito silencioso: quien aprieta el botón
      // dos veces —o dos personas a la vez— tiene que enterarse de que la segunda no hizo nada, en
      // vez de leer un «listo» que sugiere que su motivo quedó registrado como la causa del cambio.
      if (org.status === destino)
        throw new ConflictException({
          code: 'platform.org_already_in_state',
          title: destino === 'suspended' ? 'La cuenta ya está suspendida' : 'La cuenta ya está activa',
        });

      await q.query(`UPDATE organizations SET status = $2, updated_at = now() WHERE id = $1`, [id, destino]);

      // Suspender corta las sesiones; reactivar no las devuelve (no se puede «des-revocar» un token,
      // y tampoco haría falta: el usuario vuelve a entrar y listo).
      const sesiones = destino === 'suspended' ? await AuthService.revokeTenantSessionsInTx(q, id) : 0;

      await this.auditar(q, actor, {
        action,
        targetType: 'organization',
        targetId: id,
        targetTenantId: id,
        detail: { motivo, estado_anterior: org.status, estado_nuevo: destino, sesiones_revocadas: sesiones },
      });

      return {
        id,
        name: org.name,
        status: destino,
        previous_status: org.status,
        revoked_sessions: sesiones,
        // Se dice explícitamente: el cambio NO es instantáneo para quien ya tiene un access token
        // en la mano. Ocultarlo haría que soporte reportara «lo suspendí y sigue entrando».
        note:
          destino === 'suspended'
            ? 'Las sesiones activas fueron revocadas. Un token de acceso ya emitido puede seguir valiendo hasta 15 minutos.'
            : 'La cuenta puede volver a ingresar.',
      };
    });
  }

  async changePlan(actor: PlatformActor, id: string, body: { plan_code?: string; reason?: string }) {
    this.assertPuede(actor, 'organization.change_plan');
    const motivo = this.motivo(body?.reason);
    const code = String(body?.plan_code ?? '').trim();
    if (!code) throw new BadRequestException({ code: 'platform.missing_plan', title: 'plan_code es obligatorio' });

    return this.pdb.write(async (q) => {
      const org = await q.one<{ id: string; name: string }>(
        `SELECT id, name FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!org) throw new NotFoundException({ code: 'platform.org_not_found', title: 'Organización no encontrada' });

      const plan = await q.one<{ id: string; name: string }>(
        `SELECT id, name FROM plans WHERE code = $1 AND is_active = true AND deleted_at IS NULL`,
        [code],
      );
      if (!plan) throw new NotFoundException({ code: 'platform.plan_not_found', title: `Plan no encontrado: ${code}` });

      const sub = await q.one<{ id: string; plan_code: string; plan_name: string }>(
        `SELECT s.id, p.code AS plan_code, p.name AS plan_name
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT 1`,
        [id],
      );
      // No se CREA una suscripción desde acá: la policy es `FOR UPDATE` a propósito. Una cuenta sin
      // suscripción la crea el flujo de facturación (read-through de trial) la primera vez que
      // entra a su pantalla de plan; inventarla desde el panel duplicaría esa regla.
      if (!sub)
        throw new ConflictException({
          code: 'platform.no_subscription',
          title: 'La cuenta todavía no tiene suscripción: no hay plan que cambiar.',
        });
      if (sub.plan_code === code)
        throw new ConflictException({ code: 'platform.same_plan', title: `La cuenta ya está en el plan ${code}` });

      await q.query(`UPDATE subscriptions SET plan_id = $2, updated_at = now() WHERE id = $1`, [sub.id, plan.id]);

      await this.auditar(q, actor, {
        action: 'organization.change_plan',
        targetType: 'organization',
        targetId: id,
        targetTenantId: id,
        detail: { motivo, plan_anterior: sub.plan_code, plan_nuevo: code },
      });

      return {
        id,
        name: org.name,
        plan: { code, name: plan.name },
        previous_plan: sub.plan_code,
        // El cambio de plan NO cobra ni reembolsa: eso es del proveedor de pagos. Decirlo en la
        // respuesta evita que alguien asuma que subir de plan ya facturó la diferencia.
        note: 'Se cambió el plan y sus límites. No se generó ningún cobro ni ajuste de facturación.',
      };
    });
  }

  // ── Usuarios ─────────────────────────────────────────────────────────────────────────────────

  async blockUser(actor: PlatformActor, id: string, body: { reason?: string }) {
    return this.cambiarEstadoUsuario(actor, id, 'blocked', 'user.block', body);
  }

  async unblockUser(actor: PlatformActor, id: string, body: { reason?: string }) {
    return this.cambiarEstadoUsuario(actor, id, 'active', 'user.unblock', body);
  }

  private async cambiarEstadoUsuario(
    actor: PlatformActor,
    id: string,
    destino: 'active' | 'blocked',
    action: PlatformAction,
    body: { reason?: string },
  ) {
    this.assertPuede(actor, action);
    const motivo = this.motivo(body?.reason);

    // Antes de mirar la base: «no podés bloquearte a vos mismo» es una afirmación sobre QUIÉN PIDE,
    // no sobre el estado del objetivo. Comprobarlo después de la búsqueda ataba la protección a que
    // la fila existiera, y la hacía depender del orden de los chequeos de más abajo.
    //
    // Importa porque el que se bloquea a sí mismo se queda afuera del panel sin nadie que lo saque:
    // solo `superadmin` puede desbloquear, así que puede significar perder el acceso al sistema.
    if (destino === 'blocked' && id === actor.userId)
      throw new ConflictException({ code: 'platform.self_block', title: 'No podés bloquear tu propia cuenta.' });

    return this.pdb.write(async (q) => {
      const user = await q.one<{ id: string; email: string; full_name: string; status: string }>(
        `SELECT id, email, full_name, status FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!user) throw new NotFoundException({ code: 'platform.user_not_found', title: 'Usuario no encontrado' });

      // Un usuario `deleted` no se «desbloquea» a activo desde acá: el borrado tiene su propio
      // significado y revivir una cuenta borrada con el botón de desbloquear sería una sorpresa.
      if (user.status === 'deleted')
        throw new ConflictException({
          code: 'platform.user_deleted',
          title: 'El usuario está eliminado: no se puede cambiar su estado desde el panel.',
        });
      if (user.status === destino)
        throw new ConflictException({
          code: 'platform.user_already_in_state',
          title: destino === 'blocked' ? 'El usuario ya está bloqueado' : 'El usuario ya está activo',
        });

      await q.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [id, destino]);
      const sesiones = destino === 'blocked' ? await AuthService.revokeUserSessionsInTx(q, id) : 0;

      await this.auditar(q, actor, {
        action,
        targetType: 'user',
        targetId: id,
        detail: { motivo, email: user.email, estado_anterior: user.status, estado_nuevo: destino, sesiones_revocadas: sesiones },
      });

      return {
        id,
        name: user.full_name,
        email: user.email,
        status: destino,
        previous_status: user.status,
        revoked_sessions: sesiones,
        note:
          destino === 'blocked'
            ? 'Las sesiones activas fueron revocadas. Un token de acceso ya emitido puede seguir valiendo hasta 15 minutos.'
            : 'El usuario puede volver a ingresar.',
      };
    });
  }

  // ── Comunes ──────────────────────────────────────────────────────────────────────────────────

  private assertPuede(actor: PlatformActor, action: PlatformAction): void {
    if (!canPerform(actor.role, action))
      throw new ForbiddenException({
        code: 'platform.action_not_allowed',
        title: `Tu rol (${actor.role}) no puede ejecutar esta acción.`,
      });
  }

  private motivo(raw: unknown): string {
    try {
      return validateReason(raw);
    } catch (e) {
      throw new BadRequestException({ code: 'platform.reason_required', title: (e as Error).message });
    }
  }

  /**
   * Bitácora DENTRO de la transacción de la acción, y no con `pdb.audit()`.
   *
   * `audit()` abre su propia transacción y se traga los errores, que es lo correcto para registrar
   * una LECTURA: perder una línea de log no puede tumbar una consulta. Pero para una escritura la
   * regla se invierte — una suspensión sin registro de quién y por qué es exactamente lo que este
   * módulo existe para impedir. Acá el registro es parte de la operación: si no se puede escribir,
   * la acción entera se revierte.
   */
  private async auditar(
    q: Q,
    actor: PlatformActor,
    entry: {
      action: PlatformAction;
      targetType: string;
      targetId: string;
      targetTenantId?: string;
      detail: Record<string, unknown>;
    },
  ): Promise<void> {
    await q.query(
      `INSERT INTO platform_audit_logs
         (actor_user_id, actor_email, actor_role, action, outcome, target_type, target_id, target_tenant_id, detail)
       VALUES ($1,$2,$3,$4,'ok',$5,$6,$7,$8)`,
      [
        actor.userId,
        actor.email,
        actor.role,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.targetTenantId ?? null,
        JSON.stringify({ ...entry.detail, mfa: actor.mfa }),
      ],
    );
  }
}
