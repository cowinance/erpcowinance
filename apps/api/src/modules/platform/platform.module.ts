import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { PlatformDb } from './platform.db';
import { PlatformService } from './platform.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAuditInterceptor } from './platform-audit.interceptor';
import { PlatformActionsService } from './platform-actions.service';
import { PlatformActionsController, PlatformAuthController, PlatformReadController } from './platform.controller';

/**
 * Administración de la PLATAFORMA Cowinance — separada del ERP de cada finca.
 *
 * No comparte nada con el plano de tenant salvo la tabla `users` (una persona, una contraseña) y
 * `DbService` como driver. Ni el token, ni la clave de firma, ni el guard, ni la bitácora, ni las
 * rutas. Esa separación es el módulo: si alguna vez se mezclan, el panel deja de ser un panel de
 * plataforma y pasa a ser un `owner` con más permisos.
 *
 * El guard y el interceptor se declaran como PROVIDERS —no como `APP_GUARD`/`APP_INTERCEPTOR`—
 * porque son de este módulo, no globales. Registrarlos global obligaría a cada ruta del ERP a
 * pasar por ellos y a cada una a saber excluirse.
 */
@Module({
  controllers: [PlatformAuthController, PlatformReadController, PlatformActionsController],
  providers: [
    PlatformDb,
    PlatformService,
    PlatformAuthService,
    PlatformActionsService,
    PlatformAdminGuard,
    PlatformAuditInterceptor,
  ],
  exports: [PlatformDb],
})
export class PlatformModule implements OnModuleInit {
  private readonly logger = new Logger(PlatformModule.name);

  constructor(
    private readonly db: DbService,
    private readonly pdb: PlatformDb,
  ) {}

  /**
   * El primer administrador: el problema del huevo y la gallina.
   *
   * Nadie puede entrar al panel para dar de alta al primero. Las salidas posibles eran tres:
   *
   *  · **Crear un usuario con contraseña por defecto** — la peor. Una credencial conocida con
   *    acceso a todas las fincas, esperando a que alguien se olvide de cambiarla.
   *  · **Un script manual de SQL** — seguro, pero se ejecuta a mano en producción y no queda
   *    registro de que se hizo.
   *  · **Promover a un usuario que YA EXISTE**, nombrado por variable de entorno. Es la que está
   *    acá: no crea credenciales, no las conoce, y no puede promover a alguien que no se registró
   *    antes por el flujo normal. Si la variable apunta a un email inexistente, avisa y no hace
   *    nada.
   *
   * Idempotente: si ya es administrador, no toca nada (en particular, NO reactiva a alguien que
   * fue deshabilitado a propósito — eso sería una puerta trasera vía variable de entorno).
   */
  async onModuleInit(): Promise<void> {
    const email = process.env.PLATFORM_SUPERADMIN_EMAIL?.trim().toLowerCase();
    if (email) await this.promote(email, 'PLATFORM_SUPERADMIN_EMAIL');
    else if (this.demoBootstrapEnabled()) await this.promote('cowinance@gmail.com', 'seed demo (solo desarrollo)');
  }

  /**
   * En desarrollo con datos demo se promueve al usuario sembrado, para que el panel se pueda abrir
   * sin configurar nada. Bajo DOS condiciones a la vez —`SEED_DEMO` encendido y `NODE_ENV` distinto
   * de production— porque cualquiera de las dos sola es un accidente esperando: `SEED_DEMO=on` en
   * un servidor de pruebas con datos reales, o un `NODE_ENV` mal seteado.
   */
  private demoBootstrapEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const flag = process.env.SEED_DEMO?.trim().toLowerCase();
    return flag ? ['1', 'true', 'on', 'yes'].includes(flag) : true;
  }

  private async promote(email: string, source: string): Promise<void> {
    try {
      const user = await this.db.one<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email],
      );
      if (!user) {
        if (source.startsWith('PLATFORM_SUPERADMIN_EMAIL'))
          this.logger.warn(
            `${source}=${email} no corresponde a ningún usuario. Registralo por el flujo normal ` +
              'y reiniciá: este arranque NO crea usuarios ni contraseñas.',
          );
        return;
      }
      const existing = await this.pdb.read((q) =>
        q.one<{ id: string }>(`SELECT id FROM platform_admins WHERE user_id = $1`, [user.id]),
      );
      if (existing) return;
      await this.pdb.read((q) =>
        q.query(
          `INSERT INTO platform_admins (user_id, role, mfa_required) VALUES ($1, 'superadmin', true)`,
          [user.id],
        ),
      );
      this.logger.log(`Administrador de plataforma dado de alta: ${email} (origen: ${source})`);
      await this.pdb.audit({
        actorUserId: user.id,
        actorEmail: email,
        actorRole: 'superadmin',
        action: 'platform.bootstrap_superadmin',
        detail: { source },
      });
    } catch (e) {
      // Un problema al promover no puede impedir que la API levante: el ERP de las fincas no
      // depende del panel de plataforma.
      this.logger.warn(`No se pudo dar de alta al administrador de plataforma: ${(e as Error).message}`);
    }
  }
}
