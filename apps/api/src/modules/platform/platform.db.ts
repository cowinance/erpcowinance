import { Injectable } from '@nestjs/common';
import { DbService, type Q } from '../../db/db.service';
import { requestContext } from '../../common/request-context';

/**
 * La ÚNICA puerta a la lectura cross-tenant. Todo el módulo `platform` pasa por acá.
 *
 * `DbService.query` enruta por la transacción de la request cuando existe —la que abre el
 * `AuthInterceptor` con `app.tenant_id` fijado—, y fuera de ella va al pool sin contexto, donde la
 * RLS deniega (fail-closed). Ninguno de los dos caminos sirve para un panel global, así que este
 * servicio abre su PROPIA transacción y fija `app.platform_read`, el GUC que habilita la policy
 * `platform_read` (ver `db/rls.ts`).
 *
 * El `SET LOCAL` es lo que hace que esto sea seguro con un pool: el ajuste muere con la
 * transacción, así que la conexión vuelve al pool sin permisos de plataforma. Lo verifica el test
 * de integración («el GUC no sobrevive a la transacción»).
 */
@Injectable()
export class PlatformDb {
  constructor(private readonly db: DbService) {}

  /**
   * Corre `fn` con contexto de plataforma.
   *
   * El chequeo de `requestContext` no es paranoia decorativa: si alguna vez una ruta de platform
   * quedara sin `@Public()`, el interceptor la habría envuelto en una transacción de TENANT y
   * `DbService.tx` la reutilizaría — con lo cual el GUC de plataforma se sumaría a un contexto de
   * finca y esa request vería todo con el `app.tenant_id` de alguien puesto. Es un estado que no
   * debería poder ocurrir; si ocurre, se rompe acá y no en producción.
   */
  async read<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    if (requestContext.getStore())
      throw new Error(
        'PlatformDb corrió dentro de una request de tenant. Las rutas de /platform tienen que ' +
          'estar marcadas @Public() para que el AuthInterceptor no abra su transacción: el plano ' +
          'de plataforma no tiene tenant.',
      );
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.platform_read', 'on', true)`);
      return fn(q);
    });
  }

  /**
   * Corre `fn` con contexto de plataforma **y permiso de escritura** (fase 2).
   *
   * Fija los DOS GUCs: el de escritura habilita la policy `platform_write` sobre `subscriptions`, y
   * el de lectura hace falta igual porque un `UPDATE … WHERE` primero tiene que poder VER la fila.
   *
   * Es un método aparte de `read` justamente para que escribir sea una decisión visible en el
   * código. Si las lecturas del panel corrieran con este contexto, un `UPDATE` puesto por error en
   * una ruta de listado se ejecutaría sin que nada lo frene; así, no compila el descuido: hay que
   * llamar a `write` a propósito.
   */
  async write<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    if (requestContext.getStore())
      throw new Error('PlatformDb.write corrió dentro de una request de tenant (ver `read`).');
    return this.db.tx(async (q) => {
      await q.query(`SELECT set_config('app.platform_read', 'on', true)`);
      await q.query(`SELECT set_config('app.platform_write', 'on', true)`);
      return fn(q);
    });
  }

  /**
   * Registra una entrada en la bitácora global.
   *
   * Nunca lanza: una acción que ya ocurrió no se puede «des-hacer» porque falló su registro, y
   * convertir eso en un 500 le esconde al operador el resultado de lo que pidió. El fallo se
   * propaga como error de log, no como error de la request.
   */
  async audit(entry: PlatformAuditEntry): Promise<void> {
    try {
      await this.read((q) =>
        q.query(
          `INSERT INTO platform_audit_logs
             (actor_user_id, actor_email, actor_role, action, outcome, target_type, target_id,
              target_tenant_id, detail, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            entry.actorUserId ?? null,
            entry.actorEmail ?? null,
            entry.actorRole ?? null,
            entry.action,
            entry.outcome ?? 'ok',
            entry.targetType ?? null,
            entry.targetId ?? null,
            entry.targetTenantId ?? null,
            JSON.stringify(entry.detail ?? {}),
            entry.ip ?? null,
            entry.userAgent?.slice(0, 255) ?? null,
          ],
        ),
      );
    } catch {
      /* la bitácora no puede tumbar la operación que audita */
    }
  }
}

export interface PlatformAuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  outcome?: 'ok' | 'denied' | 'error';
  targetType?: string | null;
  targetId?: string | null;
  targetTenantId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}
