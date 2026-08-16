import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { hashPassword } from '../../common/passwords';
import { requestContext } from '../../common/request-context';
import { appBaseUrl, avisarSiFaltaAppBaseUrl } from '../../common/app-base-url';
import { EMAIL_SENDER, type EmailSender } from '../../application/ports/email-sender.port';
import { LIMITES_ADMIN, ROLES, type Role } from '../../common/permissions/matrix';
import { BillingService } from '../billing/billing.service';
import { INVITATION_TTL_DAYS, nuevoTokenDeInvitacion, partirToken } from './invitation-token';

avisarSiFaltaAppBaseUrl('invitations');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nombre visible del rol, para el email y las pantallas. Espejo de `roles.name` del seed. */
const NOMBRE_ROL: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  veterinarian: 'Veterinario',
  foreman: 'Capataz',
  worker: 'Operario',
  accountant: 'Contador',
};

/**
 * Alta de usuarios secundarios de una finca (capacidad `usuarios`).
 *
 * Hasta acá el único camino para que existiera un usuario era `POST /register`, que siempre crea
 * un `owner` con su organización nueva. Un dueño no tenía forma de sumar a su veterinario.
 *
 * ## Las tres reglas que no son permisos
 *
 * Están separadas de la matriz a propósito: la matriz dice si podés invitar, esto dice a quién.
 *
 *  1. Un `admin` no puede otorgar `owner` ni revocárselo a uno (`LIMITES_ADMIN`). Sin esto se
 *     promueve solo y la distinción entre los dos roles se evapora.
 *  2. Nadie puede quedarse sin dueño: revocar al último `owner` se rechaza. No es simetría con lo
 *     anterior —un `owner` sí puede revocar a otro `owner`—, es evitar la organización huérfana.
 *  3. Un email que ya tiene cuenta no se puede invitar. Ver `assertEmailLibre`.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly db: DbService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly billing: BillingService,
  ) {}

  // ──────────────────────────── Invitar ────────────────────────────

  async create(body: { email?: string; role?: string; farm_id?: string }) {
    const email = (body?.email ?? '').trim().toLowerCase();
    const role = (body?.role ?? '').trim() as Role;
    const farmId = (body?.farm_id ?? '').trim() || null;

    if (!email || !role)
      throw new BadRequestException({ code: 'invitation.missing_fields', title: 'email y role son obligatorios' });
    if (!EMAIL_RE.test(email))
      throw new BadRequestException({ code: 'invitation.invalid_email', title: 'El email no tiene un formato válido' });
    if (!ROLES.includes(role))
      throw new BadRequestException({
        code: 'invitation.invalid_role',
        title: `Rol desconocido: ${body?.role}. Disponibles: ${ROLES.join(', ')}`,
      });

    const actor = requestContext.getStore();
    if (actor?.role === 'admin' && LIMITES_ADMIN.noPuedeOtorgar.includes(role))
      throw new ForbiddenException({
        code: 'invitation.rol_no_otorgable',
        title: `Un administrador no puede invitar a alguien como ${NOMBRE_ROL[role]}`,
      });

    await this.assertEmailLibre(email);
    // El límite cuenta las invitaciones pendientes como lugares reservados: ver `contar()` en
    // BillingService. Va ANTES de emitir el token para no dejar una fila que nadie va a poder usar.
    await this.billing.assertWithinLimit('users');

    const t = this.db.tenant;
    const roleRow = await this.db.one<{ id: string }>(
      `SELECT id FROM roles WHERE code = $1 AND (tenant_id IS NULL OR tenant_id = $2) ORDER BY tenant_id NULLS LAST LIMIT 1`,
      [role, t],
    );
    if (!roleRow)
      throw new BadRequestException({ code: 'invitation.catalogs_missing', title: 'Los catálogos de roles no están inicializados' });

    if (farmId) {
      const finca = await this.db.one<{ id: string }>(`SELECT id FROM farms WHERE id = $1 AND deleted_at IS NULL`, [farmId]);
      if (!finca) throw new BadRequestException({ code: 'invitation.farm_not_found', title: 'La finca indicada no existe' });
    }

    const { token, secretHash } = nuevoTokenDeInvitacion(t);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000).toISOString();

    const fila = (await this.db.one<{ id: string; expires_at: string }>(
      `INSERT INTO invitations (tenant_id, email, role_id, farm_id, token, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at`,
      [t, email, roleRow.id, farmId, secretHash, expiresAt, this.db.user],
    ))!;

    // Best-effort, igual que la verificación de email en el registro: la invitación ya quedó firme
    // y se puede reenviar. Que falle el SMTP no debería deshacer el alta.
    try {
      await this.enviarEmail(email, role, token);
    } catch (err) {
      this.logger.warn(`No se pudo enviar la invitación a ${email}: ${String(err)}`);
    }

    this.logger.log(`Invitación creada: ${email} como ${role} en tenant=${t}`);
    return { id: fila.id, email, role, farm_id: farmId, expires_at: fila.expires_at };
  }

  /**
   * Un email que ya tiene cuenta SÍ se puede invitar — desde que el login sabe elegir organización.
   *
   * Antes se rechazaba, y no por seguridad: el login resolvía el tenant con la PRIMERA asignación
   * vigente, así que la asignación se habría creado bien y el invitado habría entrado siempre a su
   * organización vieja, sin ningún error visible. Con ese límite levantado se cae el caso que lo
   * motivaba: el veterinario que atiende dos fincas.
   *
   * Lo que sí se sigue rechazando es invitar a alguien que YA tiene acceso a ESTA organización.
   * Eso no es multi-organización: es invitar dos veces a la misma persona a la misma finca.
   */
  private async assertEmailLibre(email: string): Promise<void> {
    const ya = await this.db.one<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, [email]);
    if (ya) {
      const aca = await this.db.one<{ id: string }>(
        `SELECT ura.id FROM user_role_assignments ura
         WHERE ura.user_id = $1 AND ura.tenant_id = $2 AND ura.deleted_at IS NULL
           AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)`,
        [ya.id, this.db.tenant],
      );
      if (aca)
        throw new ConflictException({
          code: 'invitation.ya_es_miembro',
          title: `${email} ya tiene acceso a esta organización`,
        });
    }
    const pendiente = await this.db.one<{ id: string }>(
      `SELECT id FROM invitations
       WHERE tenant_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND deleted_at IS NULL AND expires_at > now()`,
      [this.db.tenant, email],
    );
    if (pendiente)
      throw new ConflictException({ code: 'invitation.ya_invitado', title: `Ya hay una invitación pendiente para ${email}` });
  }

  private async enviarEmail(email: string, role: Role, token: string): Promise<void> {
    const org = await this.db.one<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [this.db.tenant]);
    const link = `${appBaseUrl()}/aceptar-invitacion?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: email,
      subject: `Te invitaron a ${org?.name ?? 'una finca'} en Cowinance`,
      text:
        `Te sumaron a ${org?.name ?? 'una finca'} en Cowinance como ${NOMBRE_ROL[role]}.\n\n` +
        `Aceptá la invitación y creá tu contraseña acá:\n${link}\n\n` +
        `El enlace vence en ${INVITATION_TTL_DAYS} días. Si no esperabas esta invitación, ignorá este mensaje.`,
    });
  }

  // ──────────────────────────── Administrar ────────────────────────────

  /** Invitaciones pendientes del tenant. Las vencidas se muestran como tales, no se esconden. */
  async list() {
    return this.db.query(
      `SELECT i.id, i.email, r.code AS role, i.farm_id, f.name AS farm_name,
              i.expires_at, (i.expires_at <= now()) AS expired, u.full_name AS invited_by
       FROM invitations i
       JOIN roles r ON r.id = i.role_id
       LEFT JOIN farms f ON f.id = i.farm_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.tenant_id = $1 AND i.accepted_at IS NULL AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC`,
      [this.db.tenant],
    );
  }

  async revoke(id: string) {
    const fila = await this.db.one<{ id: string }>(
      `UPDATE invitations SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL AND deleted_at IS NULL
       RETURNING id`,
      [id, this.db.tenant],
    );
    if (!fila)
      throw new NotFoundException({ code: 'invitation.not_found', title: 'La invitación no existe o ya fue aceptada' });
    return { revoked: true };
  }

  // ──────────────────────────── Aceptar (público) ────────────────────────────

  /**
   * Qué dice la invitación, sin consumirla. La abre quien recibió el email antes de decidir.
   *
   * Devuelve lo mínimo para decidir —organización, rol, email— y NADA del tenant más allá del
   * nombre: es una ruta pública, y un token robado no debería servir para inventariar la finca.
   */
  async preview(token: string) {
    const inv = await this.buscarVigente(token);
    return {
      email: inv.email,
      role: inv.role,
      role_name: NOMBRE_ROL[inv.role as Role] ?? inv.role,
      organization_name: inv.organization_name,
      expires_at: inv.expires_at,
    };
  }

  /**
   * Consume la invitación: crea la cuenta, o suma la organización a una que ya existe.
   *
   * **Los dos caminos.** Si el email no tiene cuenta se crea, y para eso hacen falta nombre y
   * contraseña. Si ya la tiene —el veterinario que atiende otra finca— NO se le pide nada: entra
   * con las credenciales que ya usa, y pedirle una contraseña nueva sería pedirle que cambie la de
   * su otra finca. Por eso `password` y `full_name` solo se exigen en el primer caso, y esa
   * decisión se toma DESPUÉS de leer la invitación, no antes.
   *
   * Todo en UNA transacción: si algo falla, no queda ni el usuario a medio crear ni la invitación
   * marcada como aceptada. El `UPDATE … WHERE accepted_at IS NULL RETURNING` al final es lo que
   * hace el consumo single-use — dos requests simultáneas con el mismo token, y la segunda no
   * encuentra fila que actualizar.
   */
  async accept(body: { token?: string; password?: string; full_name?: string }) {
    const partido = partirToken(body?.token ?? '');
    const password = body?.password ?? '';
    const fullName = (body?.full_name ?? '').trim();

    if (!partido) throw new BadRequestException({ code: 'invitation.invalid_token', title: 'Invitación inválida o vencida' });

    return this.db.tx(async (q) => {
      // Sin esto la RLS esconde la fila: ver `invitation-token.ts` para por qué el tenant viaja
      // en el token.
      await this.db.applyTenantContext(q, partido.tenantId);

      const inv = await q.one<{ id: string; email: string; role_id: string; farm_id: string | null }>(
        `SELECT id, email, role_id, farm_id FROM invitations
         WHERE token = $1 AND tenant_id = $2 AND accepted_at IS NULL AND deleted_at IS NULL AND expires_at > now()`,
        [partido.secretHash, partido.tenantId],
      );
      if (!inv) throw new BadRequestException({ code: 'invitation.invalid_token', title: 'Invitación inválida o vencida' });

      // La cuenta pudo nacer entre que se mandó el email y se abrió el enlace: o esa persona se
      // registró por su cuenta, o ya trabajaba en otra finca. Los dos casos terminan igual acá.
      const existente = await q.one<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [inv.email],
      );

      let user: { id: string };
      if (existente) {
        // Ya tiene cuenta: se suma la organización y listo. Sin tocarle la contraseña ni el nombre
        // —son de su cuenta, no de esta finca—, y sin exigírselos en el formulario.
        const yaAca = await q.one<{ id: string }>(
          `SELECT id FROM user_role_assignments
           WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
             AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`,
          [existente.id, partido.tenantId],
        );
        if (yaAca)
          throw new ConflictException({
            code: 'invitation.ya_es_miembro',
            title: 'Ya tenés acceso a esta organización',
          });
        user = existente;
      } else {
        if (!fullName)
          throw new BadRequestException({ code: 'invitation.missing_fields', title: 'full_name es obligatorio' });
        if (password.length < 8)
          throw new BadRequestException({
            code: 'invitation.weak_password',
            title: 'La contraseña debe tener al menos 8 caracteres',
          });
        // El email queda verificado de entrada: llegar con el token ES la prueba de que controla
        // esa casilla, que es justo lo que verifica el flujo de verificación.
        user = (await q.one<{ id: string }>(
          `INSERT INTO users (email, full_name, password_hash, email_verified_at)
           VALUES ($1,$2,$3, now()) RETURNING id`,
          [inv.email, fullName, await hashPassword(password)],
        ))!;
      }

      await q.query(
        `INSERT INTO user_role_assignments (tenant_id, user_id, role_id, farm_id, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [partido.tenantId, user.id, inv.role_id, inv.farm_id, null],
      );

      const consumida = await q.one<{ id: string }>(
        `UPDATE invitations SET accepted_at = now(), updated_at = now()
         WHERE id = $1 AND accepted_at IS NULL RETURNING id`,
        [inv.id],
      );
      if (!consumida)
        throw new ConflictException({ code: 'invitation.ya_aceptada', title: 'Esa invitación ya fue aceptada' });

      this.logger.log(
        `Invitación aceptada: user=${user.id} en tenant=${partido.tenantId} (${existente ? 'cuenta existente' : 'cuenta nueva'})`,
      );
      // No emite tokens, igual que `register`: el cliente llama a `/auth/login` después. Mantiene
      // desacoplado invitations → auth.
      //
      // `cuenta_nueva` le dice a la pantalla qué mensaje mostrar: quien ya tenía cuenta entra con
      // la contraseña que ya usa, y decirle «creá tu contraseña» sería mandarlo a cambiar la de su
      // otra finca.
      return { user_id: user.id, email: inv.email, cuenta_nueva: !existente };
    });
  }

  /**
   * Busca la invitación vigente de un token para las rutas públicas de lectura.
   *
   * `email_verified_at` se fija al aceptar, no acá: llegar con el token ya ES la prueba de que la
   * persona controla esa casilla, que es exactamente lo que verifica el flujo de verificación.
   */
  private async buscarVigente(token: string) {
    const partido = partirToken(token);
    if (!partido) throw new NotFoundException({ code: 'invitation.invalid_token', title: 'Invitación inválida o vencida' });
    return this.db.tx(async (q) => {
      await this.db.applyTenantContext(q, partido.tenantId);
      const inv = await q.one<{ email: string; role: string; expires_at: string; organization_name: string }>(
        `SELECT i.email, r.code AS role, i.expires_at, o.name AS organization_name
         FROM invitations i
         JOIN roles r ON r.id = i.role_id
         JOIN organizations o ON o.id = i.tenant_id
         WHERE i.token = $1 AND i.tenant_id = $2 AND i.accepted_at IS NULL AND i.deleted_at IS NULL AND i.expires_at > now()`,
        [partido.secretHash, partido.tenantId],
      );
      if (!inv) throw new NotFoundException({ code: 'invitation.invalid_token', title: 'Invitación inválida o vencida' });
      return inv;
    });
  }
}
