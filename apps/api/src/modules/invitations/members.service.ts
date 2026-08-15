import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { LIMITES_ADMIN, type Role } from '../../common/permissions/matrix';

/**
 * Quién tiene acceso a la organización, y cómo se le saca.
 *
 * Va junto a las invitaciones y no en `identity` porque es la otra mitad de la misma capacidad:
 * `usuarios` no se puede operar viendo solo lo pendiente. Quien abre la pantalla quiere las dos
 * listas —los que ya están y los que fueron invitados— y las dos acciones.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Miembros con acceso vigente.
   *
   * `valid_until` se respeta acá igual que en el login: una asignación vencida no es acceso, y
   * mostrarla como si lo fuera haría que alguien intente revocar algo que ya no existe.
   */
  async list() {
    return this.db.query(
      `SELECT u.id AS user_id, u.email, u.full_name, u.status, u.last_login_at,
              r.code AS role, ura.farm_id, f.name AS farm_name, ura.valid_until
       FROM user_role_assignments ura
       JOIN users u ON u.id = ura.user_id AND u.deleted_at IS NULL
       JOIN roles r ON r.id = ura.role_id
       LEFT JOIN farms f ON f.id = ura.farm_id
       WHERE ura.tenant_id = $1 AND ura.deleted_at IS NULL
         AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)
       ORDER BY u.full_name`,
      [this.db.tenant],
    );
  }

  /**
   * Saca a alguien de la organización.
   *
   * Tres guardas, y las tres protegen cosas distintas:
   *
   *  1. **Un `admin` no revoca a un `owner`** (`LIMITES_ADMIN`). Es la contracara de no poder
   *     otorgarlo: sin las dos, el admin puede sacar al dueño y quedarse con la finca.
   *  2. **No se revoca al último `owner`.** Esta aplica hasta al dueño mismo, y no es simetría con
   *     la anterior —un dueño sí puede sacar a otro dueño—: es que una organización sin ningún
   *     `owner` no la puede recuperar nadie desde la aplicación. Terminaría en un pedido de
   *     soporte con acceso a la base.
   *  3. **Nadie se saca a sí mismo.** Es siempre un accidente, y el resultado —perder el acceso a
   *     tu propia finca en el próximo login— no tiene deshacer.
   */
  async revoke(userId: string) {
    const t = this.db.tenant;
    const actor = requestContext.getStore();

    if (actor?.userId === userId)
      throw new BadRequestException({
        code: 'member.no_a_si_mismo',
        title: 'No podés quitarte a vos mismo el acceso',
      });

    const objetivo = await this.db.one<{ role: string; full_name: string }>(
      `SELECT r.code AS role, u.full_name
       FROM user_role_assignments ura
       JOIN roles r ON r.id = ura.role_id
       JOIN users u ON u.id = ura.user_id
       WHERE ura.tenant_id = $1 AND ura.user_id = $2 AND ura.deleted_at IS NULL`,
      [t, userId],
    );
    if (!objetivo)
      throw new NotFoundException({ code: 'member.not_found', title: 'Esa persona no tiene acceso a esta organización' });

    if (actor?.role === 'admin' && LIMITES_ADMIN.noPuedeRevocar.includes(objetivo.role as Role))
      throw new ForbiddenException({
        code: 'member.rol_no_revocable',
        title: 'Un administrador no puede quitarle el acceso al propietario',
      });

    if (objetivo.role === 'owner') {
      const otros = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
         WHERE ura.tenant_id = $1 AND ura.user_id <> $2 AND ura.deleted_at IS NULL AND r.code = 'owner'
           AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)`,
        [t, userId],
      );
      if ((otros?.n ?? 0) === 0)
        throw new BadRequestException({
          code: 'member.ultimo_propietario',
          title: 'No podés dejar la organización sin ningún propietario',
          detail: 'Nombrá a otro propietario antes de quitarle el acceso a este.',
        });
    }

    await this.db.query(
      `UPDATE user_role_assignments SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [t, userId],
    );

    this.logger.log(`Acceso revocado: user=${userId} (${objetivo.role}) en tenant=${t}`);
    // Las sesiones vivas siguen siendo válidas hasta que venza el access token. Es la misma
    // ventana que ya acepta el resto del sistema; revocarlas exigiría que este módulo dependa de
    // `auth`, y el corte se puede hacer después sin cambiar este contrato.
    return { revoked: true };
  }
}
