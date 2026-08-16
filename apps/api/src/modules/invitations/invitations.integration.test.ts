import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { nuevoTokenDeInvitacion } from './invitation-token';
import type { EmailMessage, EmailSender } from '../../application/ports/email-sender.port';

/**
 * Alta de usuarios secundarios: el dueño invita, el invitado acepta y entra con SU rol.
 *
 * El token se saca del email capturado y no de la base a propósito: es el único camino por el que
 * llega en la vida real, y probarlo así verifica de paso que el enlace se arma bien. Si el email
 * no se enviara, estos tests fallarían — que es lo que uno quiere de una invitación por email.
 */
describe('invitaciones — el dueño suma a su veterinario', () => {
  let db: DbService;
  let invitations: InvitationsService;
  let members: MembersService;
  let auth: AuthService;
  let enviados: EmailMessage[];
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let ownerId: string;

  /** Adaptador de email que guarda en memoria: de acá sale el token que usaría una persona. */
  const emailFalso: EmailSender = {
    send: async (m) => {
      enviados.push(m);
    },
  };

  /** Extrae el token del enlace del último email. */
  const ultimoToken = (): string => {
    const link = /aceptar-invitacion\?token=([^\s]+)/.exec(enviados.at(-1)?.text ?? '');
    if (!link) throw new Error('el email no traía enlace de invitación');
    return decodeURIComponent(link[1]);
  };

  /** Corre como un actor concreto, que es lo que mira `LIMITES_ADMIN`. */
  const como = <T>(role: string, fn: () => Promise<T>, userId = ownerId): Promise<T> =>
    requestContext.run({ userId, tenantId, role }, fn);

  /**
   * Afirma el CÓDIGO del rechazo, no el texto.
   *
   * Los `HttpException` de Nest llevan el payload en `response` y dejan en `message` el nombre
   * genérico de la clase («Forbidden Exception»), así que un `toThrow(/regex/)` acá compara contra
   * el nombre y pasa —o falla— por el motivo equivocado. Además el código es el contrato: el
   * título está para que lo lea una persona y puede reescribirse sin romper a nadie.
   */
  const rechaza = async (codigo: string, fn: () => Promise<unknown>) => {
    await expect(fn()).rejects.toMatchObject({ response: { code: codigo } });
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'invit-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    invitations = new InvitationsService(db, emailFalso, new BillingService(db));
    members = new MembersService(db);
    auth = new AuthService(db);
    tenantId = db.tenant;
    ownerId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Cada test arranca con la organización como la dejó el seed: solo el dueño.
   *
   * No alcanza con borrar las invitaciones. Los tests que ACEPTAN dejan un usuario real, y el plan
   * de prueba admite cinco: sin esta limpieza, los usuarios de unos tests consumen el cupo de los
   * otros y el resultado pasa a depender del orden en que corren — que es la peor forma de test
   * intermitente, porque falla el test equivocado.
   */
  beforeEach(async () => {
    enviados = [];
    await db.query(`DELETE FROM invitations`);
    const deTest = `SELECT id FROM users WHERE email LIKE '%@ejemplo.com'`;
    await db.query(`DELETE FROM auth_refresh_tokens WHERE user_id IN (${deTest})`);
    await db.query(`DELETE FROM user_role_assignments WHERE user_id IN (${deTest})`);
    await db.query(`DELETE FROM users WHERE email LIKE '%@ejemplo.com'`);
  });

  it('el ciclo completo: invitar, aceptar y entrar con el rol nuevo', async () => {
    const email = `vet${Date.now()}@ejemplo.com`;
    const inv: any = await como('owner', () => invitations.create({ email, role: 'veterinarian' }));
    expect(inv.role).toBe('veterinarian');

    // El email salió y trae el enlace.
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(email);
    const token = ultimoToken();

    // Quien lo recibe ve a qué lo invitaron ANTES de poner una contraseña.
    const previa: any = await invitations.preview(token);
    expect(previa.email).toBe(email);
    expect(previa.role_name).toBe('Veterinario');
    expect(previa.organization_name).toBeTruthy();

    const aceptada: any = await invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Vet Invitado' });
    expect(aceptada.email).toBe(email);

    // Y ahora entra: el token trae SU rol, no el del que lo invitó.
    const sesion: any = await auth.login({ email, password: 'unaClaveLarga' });
    expect(sesion.user.role).toBe('veterinarian');
    expect(sesion.user.tenant_id).toBe(tenantId);

    // Aparece en el listado de miembros y ya no en el de pendientes.
    const gente: any[] = await como('owner', () => members.list());
    expect(gente.some((m) => m.email === email && m.role === 'veterinarian')).toBe(true);
    const pendientes: any[] = await como('owner', () => invitations.list());
    expect(pendientes.some((p) => p.email === email)).toBe(false);
  }, 60_000);

  it('el token es de un solo uso', async () => {
    const email = `unico${Date.now()}@ejemplo.com`;
    await como('owner', () => invitations.create({ email, role: 'worker' }));
    const token = ultimoToken();
    await invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Operario' });
    await expect(invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Otro' })).rejects.toThrow();
  }, 60_000);

  it('una invitación vencida no sirve', async () => {
    const email = `vencida${Date.now()}@ejemplo.com`;
    const inv: any = await como('owner', () => invitations.create({ email, role: 'worker' }));
    const token = ultimoToken();
    await db.query(`UPDATE invitations SET expires_at = now() - INTERVAL '1 day' WHERE id = $1`, [inv.id]);
    await expect(invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Tarde' })).rejects.toThrow();
    await expect(invitations.preview(token)).rejects.toThrow();
  }, 60_000);

  it('una invitación revocada no se puede aceptar', async () => {
    const email = `revocada${Date.now()}@ejemplo.com`;
    const inv: any = await como('owner', () => invitations.create({ email, role: 'foreman' }));
    const token = ultimoToken();
    await como('owner', () => invitations.revoke(inv.id));
    await expect(invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Nadie' })).rejects.toThrow();
  }, 60_000);

  /**
   * El token lleva el tenant adelante para poder fijar el contexto de RLS en un flujo público.
   * Esto verifica que ese prefijo no sea una llave: cambiarlo por otra organización tiene que
   * fallar, porque el hash del secreto no está en ESE tenant.
   */
  it('falsear el tenant del token no abre nada', async () => {
    const email = `falso${Date.now()}@ejemplo.com`;
    await como('owner', () => invitations.create({ email, role: 'worker' }));
    const token = ultimoToken();
    const secreto = token.slice(token.indexOf('.') + 1);

    // El seed carga una segunda organización (El Samán): sirve de tenant ajeno real.
    const otro = await db.one<{ id: string }>(`SELECT id FROM organizations WHERE id <> $1 LIMIT 1`, [tenantId]);
    expect(otro, 'el seed tiene que traer una segunda organización para esta prueba').toBeTruthy();
    await expect(
      invitations.accept({ token: `${otro!.id}.${secreto}`, password: 'unaClaveLarga', full_name: 'Intruso' }),
    ).rejects.toThrow();

    // Un tenant que ni siquiera es un UUID se descarta antes de tocar la base.
    await expect(
      invitations.accept({ token: 'no-es-un-uuid.secreto', password: 'unaClaveLarga', full_name: 'X' }),
    ).rejects.toThrow();

    // Y el token legítimo sigue funcionando: lo anterior no lo quemó.
    const ok: any = await invitations.accept({ token, password: 'unaClaveLarga', full_name: 'Legítimo' });
    expect(ok.email).toBe(email);
  }, 60_000);

  it('un administrador no puede invitar a alguien como propietario', async () => {
    await rechaza('invitation.rol_no_otorgable', () =>
      como('admin', () => invitations.create({ email: `jefe${Date.now()}@ejemplo.com`, role: 'owner' })),
    );
    // Pero sí puede invitar al resto.
    const ok: any = await como('admin', () => invitations.create({ email: `capataz${Date.now()}@ejemplo.com`, role: 'foreman' }));
    expect(ok.role).toBe('foreman');
  }, 60_000);

  it('no se invita a quien YA tiene acceso a esta organización', async () => {
    await rechaza('invitation.ya_es_miembro', () =>
      como('owner', () => invitations.create({ email: 'cowinance@gmail.com', role: 'worker' })),
    );
  }, 60_000);

  /**
   * El caso que motivó levantar el `LIMIT 1` del login: un veterinario que atiende dos fincas.
   *
   * Antes se rechazaba porque el login resolvía el tenant con la primera asignación vigente, así
   * que la asignación se creaba bien y la persona entraba SIEMPRE a su organización vieja, sin
   * ningún error visible. Ahora acepta, queda en las dos, y elige al entrar.
   */
  it('a quien ya tiene cuenta en OTRA finca se lo invita y queda en las dos', async () => {
    const email = `dos.fincas${Date.now()}@ejemplo.com`;

    // Primera finca: se crea la cuenta por el camino normal.
    await como('owner', () => invitations.create({ email, role: 'veterinarian' }));
    const primera: any = await invitations.accept({
      token: ultimoToken(),
      password: 'unaClaveLarga',
      full_name: 'Vet De Dos Fincas',
    });
    expect(primera.cuenta_nueva).toBe(true);

    // Segunda finca: otra organización invita al MISMO email.
    const otra = await db.one<{ id: string }>(`SELECT id FROM organizations WHERE id <> $1 LIMIT 1`, [tenantId]);
    expect(otra, 'el seed tiene que traer una segunda organización').toBeTruthy();
    const rol = await db.one<{ id: string }>(`SELECT id FROM roles WHERE code = 'foreman' AND tenant_id IS NULL`);
    const { token, secretHash } = nuevoTokenDeInvitacion(otra!.id);
    await db.query(
      `INSERT INTO invitations (tenant_id, email, role_id, token, expires_at)
       VALUES ($1,$2,$3,$4, now() + INTERVAL '7 days')`,
      [otra!.id, email, rol!.id, secretHash],
    );

    // No se le piden nombre ni contraseña: ya tiene cuenta, entra con la que usa.
    const segunda: any = await invitations.accept({ token });
    expect(segunda.cuenta_nueva).toBe(false);
    expect(segunda.user_id).toBe(primera.user_id); // la MISMA persona, no una cuenta nueva

    // Y ahora pertenece a las dos, con un rol distinto en cada una.
    const orgs = await db.query<{ tenant_id: string; role: string }>(
      `SELECT ura.tenant_id, r.code AS role FROM user_role_assignments ura
       JOIN roles r ON r.id = ura.role_id
       WHERE ura.user_id = $1 AND ura.deleted_at IS NULL ORDER BY ura.created_at`,
      [primera.user_id],
    );
    expect(orgs.map((o) => o.role)).toEqual(['veterinarian', 'foreman']);
  }, 60_000);

  it('no se invita dos veces al mismo email', async () => {
    const email = `doble${Date.now()}@ejemplo.com`;
    await como('owner', () => invitations.create({ email, role: 'worker' }));
    await rechaza('invitation.ya_invitado', () => como('owner', () => invitations.create({ email, role: 'worker' })));
  }, 60_000);

  it('el rol tiene que existir', async () => {
    await rechaza('invitation.invalid_role', () =>
      como('owner', () => invitations.create({ email: `raro${Date.now()}@ejemplo.com`, role: 'astronauta' })),
    );
  }, 60_000);

  describe('sacar a alguien', () => {
    it('un administrador no puede quitarle el acceso al propietario', async () => {
      await rechaza('member.rol_no_revocable', () => como('admin', () => members.revoke(ownerId), 'un-admin'));
    }, 60_000);

    it('no se puede dejar la organización sin ningún propietario', async () => {
      // Lo intenta OTRO owner, para que no lo frene el guard de "no a vos mismo".
      await rechaza('member.ultimo_propietario', () => como('owner', () => members.revoke(ownerId), 'otro-owner'));
    }, 60_000);

    it('nadie se saca a sí mismo', async () => {
      await rechaza('member.no_a_si_mismo', () => como('owner', () => members.revoke(ownerId)));
    }, 60_000);

    /**
     * REGRESIÓN. Quitar el acceso NO lo quitaba: el login devolvía 401, pero el refresh seguía
     * funcionando siete días y devolvía un token con el rol viejo que la API aceptaba. Comprobado
     * a mano contra la API antes de arreglarlo: revocado, `/animals` daba 200.
     *
     * Se cierra por dos lados y se prueban los dos: `members.revoke` revoca los refresh de esa
     * persona en esa organización (inmediato), y `AuthService.refresh` revalida la asignación
     * (cubre además los cambios de rol y los vencimientos de `valid_until`).
     */
    it('quitar el acceso corta la sesión viva, no solo el próximo login', async () => {
      const email = `revocado${Date.now()}@ejemplo.com`;
      await como('owner', () => invitations.create({ email, role: 'foreman' }));
      const nuevo: any = await invitations.accept({
        token: ultimoToken(),
        password: 'unaClaveLarga',
        full_name: 'Capataz Saliente',
      });
      const sesion: any = await auth.login({ email, password: 'unaClaveLarga' });
      expect(sesion.refresh_token).toBeTruthy();

      await como('owner', () => members.revoke(nuevo.user_id));

      await expect(auth.login({ email, password: 'unaClaveLarga' })).rejects.toThrow();
      await expect(auth.refresh({ refresh_token: sesion.refresh_token })).rejects.toThrow();
    }, 60_000);

    it('a un invitado sí se lo puede sacar, y deja de figurar', async () => {
      const email = `saliente${Date.now()}@ejemplo.com`;
      await como('owner', () => invitations.create({ email, role: 'worker' }));
      const token = ultimoToken();
      const nuevo: any = await invitations.accept({ token, password: 'unaClaveLarga', full_name: 'De Paso' });

      await como('owner', () => members.revoke(nuevo.user_id));
      const gente: any[] = await como('owner', () => members.list());
      expect(gente.some((m) => m.user_id === nuevo.user_id)).toBe(false);
    }, 60_000);
  });

  /**
   * `max_users` existía en `plans` desde siempre y el panel de plataforma ya marcaba las cuentas
   * pasadas de límite, pero no lo hacía cumplir nadie: hasta ahora no había forma de agregar un
   * segundo usuario. Las invitaciones PENDIENTES cuentan como lugar reservado — si no, mandar
   * seis con el plan en cinco pasa el chequeo seis veces.
   */
  it('el plan limita cuántos usuarios se pueden sumar, contando los pendientes', async () => {
    const plan = await db.one<{ max_users: number }>(
      `SELECT p.max_users FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId],
    );
    const usuarios = (await db.one<{ n: number }>(
      `SELECT count(DISTINCT user_id)::int AS n FROM user_role_assignments WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    ))!.n;
    const lugares = (plan?.max_users ?? 0) - usuarios;
    expect(lugares).toBeGreaterThan(0);

    for (let i = 0; i < lugares; i++)
      await como('owner', () => invitations.create({ email: `cupo${i}-${Date.now()}@ejemplo.com`, role: 'worker' }));

    // El siguiente ya no entra: las pendientes ocupan lugar aunque nadie las haya aceptado.
    await rechaza('plan.limit_reached', () =>
      como('owner', () => invitations.create({ email: `sobra${Date.now()}@ejemplo.com`, role: 'worker' })),
    );
  }, 120_000);
});
