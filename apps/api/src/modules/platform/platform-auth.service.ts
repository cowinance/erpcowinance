import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { verifyPassword } from '../../common/passwords';
import { PlatformDb } from './platform.db';
import {
  PLATFORM_TTL_S,
  mfaEnforced,
  signPlatformToken,
  type PlatformRole,
} from './platform-session';

interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Login del panel de plataforma. Mismas credenciales que el ERP (una sola contraseña por persona,
 * un solo lugar donde rehashear y revocar), sesión distinta.
 *
 * **Por qué no se reusa `AuthService.login`**: ese login termina resolviendo un `tenant_id` desde
 * `user_role_assignments` y lanza `auth.no_tenant` si no hay ninguno. Un dueño de Cowinance que no
 * pertenece a ninguna finca —el caso normal— no puede pasar por ahí. Y forzarlo (asignarle una
 * organización cualquiera) le daría un token de tenant sobre datos de un cliente: exactamente lo
 * que se quiere evitar. Lo que sí se comparte es lo que importa compartir: el hash de la
 * contraseña y `verifyPassword`.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly db: DbService,
    private readonly pdb: PlatformDb,
  ) {}

  async login(body: { email?: string; password?: string }, meta: LoginMeta = {}) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    if (!email || !password)
      throw new UnauthorizedException({
        code: 'platform.missing_credentials',
        title: 'email y password son obligatorios',
      });

    // El mismo error para «no existe», «contraseña mal» y «no es administrador de plataforma».
    // Si el tercero dijera otra cosa, este endpoint se convertiría en un oráculo para averiguar
    // QUIÉN administra Cowinance — el dato con el que empieza un ataque dirigido.
    const invalid = () =>
      new UnauthorizedException({ code: 'platform.invalid_credentials', title: 'Credenciales inválidas' });

    // `users` no tiene RLS (plano de identidad), así que se lee sin contexto de plataforma. Y se
    // lee FUERA de la transacción a propósito: verificar la contraseña cuesta ~90 ms de scrypt, y
    // en PGlite —conexión única— sostener una transacción abierta ese rato frena a todo el proceso.
    const user = await this.db.one<{
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      status: string;
      mfa_enabled: boolean;
    }>(
      `SELECT id, email, full_name, password_hash, status, mfa_enabled
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
      await this.pdb.audit({
        action: 'platform.login',
        outcome: 'denied',
        targetType: 'user',
        targetId: email,
        detail: { reason: 'credenciales_invalidas' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw invalid();
    }

    const admin = await this.pdb.read((q) =>
      q.one<{ role: PlatformRole; mfa_required: boolean }>(
        `SELECT role, mfa_required FROM platform_admins WHERE user_id = $1 AND disabled_at IS NULL`,
        [user.id],
      ),
    );
    if (!admin) {
      await this.pdb.audit({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'platform.login',
        outcome: 'denied',
        detail: { reason: 'no_es_administrador_de_plataforma' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw invalid();
    }

    // MFA: hoy la puerta está abierta porque no hay segundo factor implementado. Cuando lo haya,
    // `PLATFORM_MFA_ENFORCED=on` la cierra sin tocar código ni esquema. Mientras tanto la sesión
    // queda marcada `mfa:false` y eso viaja a la bitácora de cada request: si algún día hay que
    // auditar «quién entró sin MFA», el dato está.
    const mfa = user.mfa_enabled;
    if (mfaEnforced() && admin.mfa_required && !mfa) {
      await this.pdb.audit({
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: admin.role,
        action: 'platform.login',
        outcome: 'denied',
        detail: { reason: 'mfa_requerido' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new ForbiddenException({
        code: 'platform.mfa_required',
        title: 'Tu cuenta de plataforma exige segundo factor y no lo tenés configurado',
      });
    }

    await this.pdb.audit({
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: admin.role,
      action: 'platform.login',
      outcome: 'ok',
      detail: { mfa },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      token_type: 'Bearer',
      access_token: signPlatformToken({ sub: user.id, prole: admin.role, mfa }),
      expires_in: PLATFORM_TTL_S,
      admin: { user_id: user.id, name: user.full_name, email: user.email, role: admin.role, mfa },
    };
  }
}
