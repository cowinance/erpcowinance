import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDriver, PostgresDriver, type SqlDriver, type TxHandle } from './driver';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { bootstrapCatalogs, seedDemo } from './seed';
import { asFarmDate, farmToday, safeTimeZone } from '@cowinance/domain';
import { requestContext } from '../common/request-context';
import { RLS_TABLES, platformMigration, rlsMigration } from './rls';
import { ROLE_PRIVILEGES_SQL, assessRolePrivileges, type RolePrivileges } from './role-privileges';
import { checksumOf, loadMigrations, recordBaseline, resolveDbPath, runMigrations } from './migrations';
import type { Q } from './query';

// Re-exportado para no romper a los consumidores que ya importan Q desde aquí.
export type { Q } from './query';

/**
 * Capa de persistencia (dev): PGlite = PostgreSQL embebido en proceso.
 * Carga el DDL canónico completo (140 tablas, packages/db/cowinance_schema.sql).
 * En producción el mismo DDL corre sobre PostgreSQL 17 + PostGIS + TimescaleDB;
 * aquí los tipos geography se degradan a jsonb (PGlite no soporta PostGIS).
 */
/**
 * Un identificador con forma inválida es un error DEL CLIENTE, no del servidor.
 *
 * Las rutas `:id` reciben el parámetro como texto y lo pasan a la consulta, donde PostgreSQL lo
 * convierte a `uuid`. Si no tiene forma de uuid falla con `22P02` y esa excepción subía sin
 * traducir: el cliente recibía **500 «Internal server error»**. Comprobado en seis rutas de seis
 * (`/tasks/:id`, `/animals/:id`, `/lots/:id`, `/clinical-cases/:id`, `/commerce/sales/:id`,
 * `/machinery/:id`).
 *
 * Importa por tres motivos: miente sobre de quién es la culpa (un 500 invita a reintentar algo que
 * no va a funcionar nunca), ensucia el monitoreo (cada enlace viejo entra al log como ERROR y tapa
 * los 500 de verdad), y filtra la clase del error de PostgreSQL.
 *
 * **Se traduce ACÁ y no en un filtro global.** Se intentaron las dos formas de filtro —re-lanzar
 * escapa al handler de Express y devuelve HTML; `BaseExceptionFilter` necesita el adaptador HTTP—
 * y las dos rompían la forma `{code, title}` de la que depende la web entera. `DbService.query` es
 * la única puerta a la base: el error nace acá, y acá se lo traduce a la excepción que el resto del
 * sistema ya sabe serializar.
 *
 * Deliberadamente estrecho: SOLO `22P02`. Cualquier otro error de base sigue siendo un 500, porque
 * cualquier otro error de base sí es un problema del servidor.
 */
function translateDbError(e: unknown): unknown {
  const code = (e as { code?: string } | null)?.code;
  if (code === '22P02')
    return new BadRequestException({ code: 'request.invalid_id', title: 'El identificador no tiene un formato válido' });
  /**
   * `25006` = «cannot execute … in a read-only transaction». En este sistema solo puede venir del
   * MODO ESPEJO: el interceptor marca la transacción como READ ONLY cuando el token es de
   * impersonation (ver `modules/platform/impersonation.ts`).
   *
   * Se traduce por el mismo motivo que el `22P02` de arriba: sin esto es un 500 «Internal server
   * error», que miente sobre de quién es la culpa e invita a reintentar algo que no va a funcionar
   * nunca. Acá la respuesta correcta es un 403 que dice exactamente qué pasó — el soporte está
   * mirando la finca de un cliente y no puede modificarla, que es el diseño y no una falla.
   */
  if (code === '25006')
    return new ForbiddenException({
      code: 'impersonation.read_only',
      title: 'Estás en modo espejo: podés ver la finca pero no modificar nada.',
    });
  return e;
}

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private db!: SqlDriver;
  private tenantId!: string;
  private farmId!: string;
  private userId!: string;

  /**
   * Arranque de la persistencia, en tres capas que NO son intercambiables:
   *
   *  1. **Esquema canónico** (`cowinance_schema.sql`) — solo si la base está vacía. Es la
   *     versión `0000`.
   *  2. **Migraciones versionadas** (`packages/db/migrations/`) — se aplican una vez y quedan
   *     registradas con su checksum; editar una ya aplicada aborta el arranque. Ver
   *     `migrations.ts`.
   *  3. **Políticas de RLS** — CONVERGENTES, no versionadas: se re-aplican en cada arranque
   *     porque se generan desde `RLS_TABLES` y tienen que seguir a esa lista (agregar una tabla
   *     a la lista crea su policy sola; versionarlas rompería esa propiedad).
   */
  async onModuleInit() {
    // Driver: PostgreSQL real si hay DATABASE_URL (prod y verificación de RLS), PGlite si no
    // (dev sin instalar nada). El resto del arranque es idéntico para ambos.
    const url = process.env.DATABASE_URL;
    if (url) {
      this.db = new PostgresDriver(url, process.env.DATABASE_ADMIN_URL);
      this.logger.log('Base: PostgreSQL real (DATABASE_URL)');
    } else {
      // PGlite en producción sería catastrófico y silencioso: una base EN PROCESO, sobre el disco
      // efímero del contenedor, que se pierde entera en el próximo deploy. Es el mismo tipo de
      // olvido que JWT_SECRET, así que la respuesta es la misma: no arrancar.
      if (process.env.NODE_ENV === 'production')
        throw new Error(
          'DATABASE_URL es obligatoria en producción. Sin ella la API usaría PGlite (base embebida ' +
            'en el proceso, sobre disco efímero): los datos se perderían en el próximo reinicio.',
        );
      const dataDir = join(process.cwd(), '.data', 'pglite');
      mkdirSync(dataDir, { recursive: true });
      this.db = new PGliteDriver(new PGlite(dataDir));
    }
    await this.db.ready();

    // ANTES de tocar el esquema: ¿el rol con el que vamos a SERVIR tiene la RLS aplicada? Si no la
    // tiene, no hay aislamiento entre fincas y no tiene sentido seguir arrancando en producción.
    // Va acá y no más abajo para fallar antes de correr migraciones (ver `role-privileges.ts`).
    await this.assertServiceRoleIsRestricted();

    // Todo el DDL de arranque va bajo un LOCK: dos instancias que arrancan a la vez —lo normal en
    // un despliegue rodante— cargarían el esquema las dos y la segunda muere con «duplicate key
    // value violates unique constraint pg_type_typname_nsp_index». Se comprobó levantando dos
    // procesos contra la misma base. La que llega segunda espera acá, y cuando entra ya encuentra
    // el esquema puesto y las migraciones aplicadas: no hace nada.
    await this.withBootLock(async () => {
      const has = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'`,
      );
      const schemaSql = this.loadSchemaSql();
      if (has.rows[0].n === 0) {
        this.logger.log('Base vacía: cargando esquema canónico (140 tablas)…');
        await this.db.exec(schemaSql);
        this.logger.log('Esquema cargado.');
      }
      // El esquema canónico es la versión 0000: se registra exista o no (una base creada antes de
      // que hubiera migraciones versionadas también lo tiene aplicado, solo que sin anotarlo).
      await recordBaseline(this.db, checksumOf(schemaSql));
      await runMigrations(this.db, loadMigrations(resolveDbPath('migrations')), (m) => this.logger.log(m));

      // El resto de las policies dispersas del DDL (`tenant_isolation_<tabla>` sobre
      // app.current_tenant) ya NO se borran acá una por una: `rlsMigration()` las elimina junto con
      // la creación de la correcta, para TODA tabla de RLS_TABLES. Antes esto eran ~33 líneas que
      // había que acordarse de sumar al activar cada módulo — y olvidarse dejaba la tabla en
      // deny-all silencioso.
      await this.db.exec(rlsMigration());

      // Plano de plataforma (panel del dueño de Cowinance): policies convergentes igual que las de
      // tenant, y por el mismo motivo — se generan desde una lista y tienen que seguirla. Va
      // DESPUÉS de `rlsMigration()` porque agrega una segunda policy sobre tablas que aquella ya
      // preparó, y después de las migraciones porque `platform_admins`/`platform_audit_logs` nacen
      // en la 0027.
      await this.db.exec(platformMigration());

      // Catálogos base + roles de sistema: SIEMPRE (idempotente). Una finca que
      // se registra self-service (P1.1) depende de que el rol `owner` exista. Va DENTRO del lock:
      // dos instancias insertando los mismos catálogos a la vez chocarían igual.
      await this.runInTx((h) => bootstrapCatalogs(h), 'Cargando catálogos base…');

      // Datos demo: solo bajo SEED_DEMO (ON en dev, OFF en prod) y si la base no tiene
      // organizaciones todavía. Sin demo, el sistema arranca vacío y espera el primer registro
      // real.
      //
      // La COMPROBACIÓN va dentro del lock junto con el seed: si estuviera afuera, dos instancias
      // podrían ver la base vacía a la vez y sembrar las dos (choca por `users_email_key`).
      const orgs = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM organizations`);
      if (orgs.rows[0].n === 0 && DbService.seedDemoEnabled()) {
        await this.runInTx((h) => seedDemo(h), 'Sembrando datos demo…');
        this.logger.log('Seed demo completado.');
      }
    });

    // Contexto por defecto para código fuera de request (boot, jobs). Con
    // SEED_DEMO off y sin registros aún, la base está vacía: no hay contexto por
    // defecto y toda operación pasa por el flujo de request (register/login).
    const org = await this.db.query<{ id: string }>(
      `SELECT id FROM organizations ORDER BY created_at LIMIT 1`,
    );
    if (!org.rows[0]) {
      this.logger.log(
        `Base sin organizaciones (SEED_DEMO off): esperando registro self-service. RLS forzada en ${RLS_TABLES.length} tablas.`,
      );
      return;
    }
    this.tenantId = org.rows[0].id;
    // GUC de SESIÓN: contexto por defecto para código fuera de request (boot, seed). Las requests
    // lo pisan con SET LOCAL dentro de su transacción.
    //
    // Solo en PGlite, donde la conexión es única y ese "default" es justamente la intención. Con
    // PostgreSQL real hay un POOL: el ajuste quedaría pegado a UNA conexión y cualquier request que
    // luego cayera en ella heredaría este tenant como contexto por defecto. Inofensivo mientras el
    // interceptor haga su SET LOCAL, pero es exactamente el tipo de estado residual que convierte
    // un bug del interceptor en una fuga cross-tenant. En Postgres se omite: cada request trae su
    // propio contexto y sin él la RLS deniega (fail-closed).
    if (this.db.kind === 'pglite') {
      await this.db.query(`SELECT set_config('app.tenant_id', $1, false)`, [this.tenantId]);
      // Y la ZONA, por el mismo motivo y para que el proceso sea internamente coherente.
      //
      // Sin esto, el código que corre FUERA de una request —el seed, los jobs, y sobre todo los
      // tests— tenía `db.today()` en hora de finca y `CURRENT_DATE` en UTC. Entre las 00:00 y las
      // 03:00 UTC eso son días distintos, así que la suite pasaba 21 horas por día y fallaba 3.
      // Un test que depende de la hora a la que se lo corre es peor que uno que falla siempre:
      // pasa en CI de mañana y explota de noche sin que nadie haya tocado nada.
      const org = await this.db.query<{ timezone: string | null }>(`SELECT timezone FROM organizations WHERE id = $1`, [this.tenantId]);
      await this.db.query(`SELECT set_config('TimeZone', $1, false)`, [safeTimeZone(org.rows[0]?.timezone)]);
    }
    const farm = await this.db.query<{ id: string }>(
      `SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [this.tenantId],
    );
    this.farmId = farm.rows[0]?.id;
    const user = await this.db.query<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
    this.userId = user.rows[0].id;
    this.logger.log(`Contexto dev: tenant=${this.tenantId} farm=${this.farmId} · RLS forzada en ${RLS_TABLES.length} tablas`);
  }

  /**
   * Comprueba que el rol de SERVICIO no saltee la RLS. Aborta el arranque en producción si la
   * saltea; fuera de producción avisa (ver `role-privileges.ts` para el razonamiento completo).
   *
   * La consulta va por `this.db.query`, que en `PostgresDriver` usa el pool de `DATABASE_URL` — la
   * conexión de servicio. NO la administrativa, que tiene que ser privilegiada para correr el DDL.
   *
   * En PGlite se saltea: es superusuario por diseño (base embebida, un solo proceso) y avisar en
   * cada arranque de desarrollo entrenaría a ignorar exactamente el mensaje que importa en
   * producción. Que en dev la RLS no se ejerce ya está documentado y lo cubre `verify:rls`.
   */
  private async assertServiceRoleIsRestricted(): Promise<void> {
    if (this.db.kind !== 'postgres') return;

    let priv: RolePrivileges | undefined;
    try {
      const res = await this.db.query<RolePrivileges>(ROLE_PRIVILEGES_SQL);
      priv = res.rows[0];
    } catch (e) {
      // No poder COMPROBAR no es lo mismo que fallar la comprobación: `pg_roles` es legible por
      // cualquiera, así que un error acá es una rareza del entorno, y tumbar el arranque por eso
      // sería peor que el problema. Se avisa fuerte y se sigue.
      this.logger.warn(
        `No se pudieron leer los privilegios del rol de servicio (${(e as Error).message}). ` +
          'Comprobalo a mano: SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;',
      );
      return;
    }
    if (!priv) {
      this.logger.warn('pg_roles no devolvió el rol actual: no se pudo verificar el aislamiento.');
      return;
    }

    const verdict = assessRolePrivileges(priv, { production: process.env.NODE_ENV === 'production' });
    if (verdict.level === 'fatal') throw new Error(verdict.message);
    if (verdict.level === 'warn') this.logger.warn(verdict.message);
    else this.logger.log(verdict.message);
  }

  /**
   * Corre `fn` con exclusión mutua entre instancias.
   *
   * `pg_advisory_lock` es un lock de SESIÓN: hay que tomarlo y soltarlo sobre la MISMA conexión,
   * de ahí el `bootHandle()` en vez de una query suelta del pool. No tiene timeout a propósito —
   * esperar a que la otra instancia termine de migrar es exactamente lo que queremos; abandonar
   * dejaría a esta instancia sirviendo sobre un esquema a medio aplicar.
   *
   * En PGlite no hace falta: es un proceso único con una sola conexión.
   */
  private async withBootLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.db.kind !== 'postgres') return fn();
    const h = await this.db.bootHandle();
    try {
      await h.query('SELECT pg_advisory_lock($1)', [DbService.BOOT_LOCK_KEY]);
      try {
        return await fn();
      } finally {
        await h.query('SELECT pg_advisory_unlock($1)', [DbService.BOOT_LOCK_KEY]);
      }
    } finally {
      h.release();
    }
  }

  /** Clave arbitraria pero FIJA: todas las instancias tienen que pedir el mismo lock. */
  private static readonly BOOT_LOCK_KEY = 727_262_001;

  /** ¿Sembrar datos demo? ON en dev por defecto, OFF en producción. Override con SEED_DEMO. */
  private static seedDemoEnabled(): boolean {
    const flag = process.env.SEED_DEMO?.trim().toLowerCase();
    if (flag) return ['1', 'true', 'on', 'yes'].includes(flag);
    return process.env.NODE_ENV !== 'production';
  }

  /** Ejecuta `fn` dentro de una transacción PGlite (BEGIN/COMMIT, ROLLBACK si lanza). */
  /**
   * Paso de arranque dentro de una transacción, sobre una conexión ÚNICA (`bootHandle`). Con un
   * pool no alcanza con `exec('BEGIN')`: cada sentencia podría tomar otra conexión y el BEGIN
   * quedaría huérfano. El handle se le pasa al callback para que el seed use ESA conexión.
   */
  private async runInTx(fn: (h: TxHandle) => Promise<void>, log?: string): Promise<void> {
    if (log) this.logger.log(log);
    const h = await this.db.bootHandle();
    try {
      await h.query('BEGIN');
      try {
        await fn(h);
        await h.query('COMMIT');
      } catch (err) {
        await h.query('ROLLBACK');
        throw err;
      }
    } finally {
      h.release();
    }
  }

  private loadSchemaSql(): string {
    const raw = readFileSync(resolveDbPath('cowinance_schema.sql'), 'utf8');
    return raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('CREATE EXTENSION'))
      .join('\n')
      .replace(/geography\([^)]*\)/g, 'jsonb');
  }

  /** Tenant del actor: contexto de la request autenticada, o el default de boot (seed/jobs). */
  get tenant(): string {
    return requestContext.getStore()?.tenantId ?? this.tenantId;
  }
  get user(): string {
    return requestContext.getStore()?.userId ?? this.userId;
  }
  /** Rol del usuario de la request (claim `role` del JWT): owner/admin/veterinarian/foreman/… */
  get role(): string | undefined {
    return requestContext.getStore()?.role;
  }
  /** Finca por defecto del tenant de boot (solo seed); las requests usan defaultFarm(). */
  get farm(): string {
    return this.farmId;
  }

  private farmCache = new Map<string, string>();
  /**
   * Primera finca del tenant actual (v0: finca única por tenant).
   *
   * **`q` cuando el llamador ya está DENTRO de una transacción**, exactamente por el mismo motivo
   * que `timeZone(q)`: en PGlite la conexión es única, así que una consulta suelta mientras hay una
   * tx abierta espera a que la tx cierre, y la tx espera a la consulta. No se nota casi nunca
   * porque la caché se llena en la primera request y a partir de ahí no hay consulta que colgar —
   * pero con la caché fría, `persistNewAnimal` cuelga la conexión entera desde adentro de su
   * propia transacción.
   *
   * Estaba "resuelto" con un `await db.defaultFarm()` de precalentamiento en un test y un comentario
   * explicando por qué hacía falta. Eso no es un arreglo: es una trampa que cada test nuevo tiene
   * que descubrir de nuevo, y que en el servidor le toca a cualquier código que cree un animal
   * como primera operación después de arrancar (un job, el seed, una carga de datos de ejemplo).
   */
  async defaultFarm(q?: Q): Promise<string> {
    const t = this.tenant;
    const cached = this.farmCache.get(t);
    if (cached) return cached;
    const sql = `SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`;
    const farm = q ? await q.one<{ id: string }>(sql, [t]) : await this.one<{ id: string }>(sql, [t]);
    if (!farm) throw new Error(`El tenant ${t} no tiene fincas`);
    this.farmCache.set(t, farm.id);
    return farm.id;
  }

  private tzCache = new Map<string, string>();

  /**
   * Zona horaria de la organización: la que define cuándo empieza y termina el día de trabajo.
   *
   * Se cachea en memoria por tenant como `defaultFarm`. La alternativa —una consulta por request—
   * sería un round-trip extra en TODAS las requests para un dato que cambia una vez en la vida de
   * la finca; la otra —meterla en el JWT— la dejaría vieja en los tokens ya emitidos y no hay forma
   * de invalidarlos.
   *
   * Si la organización no tiene una zona usable, cae a UTC en vez de lanzar: una zona mal cargada
   * no puede impedir que la app funcione.
   */
  async timeZone(q?: Q): Promise<string> {
    const t = this.tenant;
    const cached = this.tzCache.get(t);
    if (cached) return cached;
    // `q` cuando el llamador ya está DENTRO de una transacción. En PGlite la conexión es única: una
    // consulta suelta mientras hay una tx abierta se queda esperando a que cierre, y la tx espera a
    // la consulta. Se descubrió como siete tests colgados a los 5 segundos.
    const org = q
      ? await q.one<{ timezone: string | null }>(`SELECT timezone FROM organizations WHERE id = $1`, [t])
      : await this.one<{ timezone: string | null }>(`SELECT timezone FROM organizations WHERE id = $1`, [t]);
    const tz = safeTimeZone(org?.timezone);
    this.tzCache.set(t, tz);
    return tz;
  }

  /**
   * HOY en la finca (`YYYY-MM-DD`).
   *
   * Es el reemplazo de `new Date().toISOString().slice(0, 10)`, que es UTC siempre: en Venezuela
   * fechaba al día siguiente todo lo cargado después de las 20:00. Cualquier servicio que necesite
   * "hoy" para un dato de negocio tiene que pedirlo acá, no calcularlo.
   */
  async today(q?: Q): Promise<string> {
    return farmToday(await this.timeZone(q));
  }

  /**
   * La fecha de finca de un valor que puede ser un INSTANTE o una FECHA calendario.
   *
   * Es la otra mitad de `today()`, y faltaba. Las cinco guardas de «esto no puede ser futuro»
   * comparaban contra `today()` —que ya era la fecha de la finca— pero al valor entrante le cortaban
   * los diez primeros caracteres de su ISO, que es UTC. Media comparación en cada zona: a las 21:00
   * en Buenos Aires un hecho de AHORA tiene fecha UTC de mañana, así que el sistema rechazaba con
   * «la fecha es futura» lo que el productor acababa de ver. Tres horas por día, todas las noches, y
   * justo en el horario en que se encierra el rodeo.
   *
   * `asFarmDate` distingue lo que hay que distinguir: una fecha calendario no tiene zona y vuelve
   * intacta; un instante sí la tiene y se convierte. Convertir una fecha calendario la correría un
   * día para atrás, que es el error simétrico.
   */
  async farmDateOf(value: string | Date, q?: Q): Promise<string> {
    return asFarmDate(value, await this.timeZone(q));
  }

  /**
   * Fija el contexto del tenant en la transacción: aislamiento (RLS) y zona horaria.
   *
   * Las dos cosas juntas y en un solo lugar a propósito. Iban separadas —el `set_config` de
   * `app.tenant_id` estaba copiado en el interceptor, el importador y el registro— y la zona no se
   * fijaba en ninguno, así que los 95 `CURRENT_DATE` del sistema corrían en la del servidor. Con un
   * único punto, agregar contexto de sesión deja de ser "acordarse de tres lugares".
   *
   * `set_config('TimeZone', …)` y no `SET LOCAL TIME ZONE`: el segundo no admite parámetros y
   * habría que interpolar la cadena en el SQL. El valor viene de la base, pero interpolar lo que
   * salió de una columna editable es exactamente el hábito que después se copia donde sí importa.
   */
  async applyTenantContext(q: Q, tenantId: string): Promise<void> {
    await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    // La zona se resuelve DENTRO de la misma transacción, con el handle: ver `timeZoneOf`.
    await q.query(`SELECT set_config('TimeZone', $1, true)`, [await this.timeZoneOf(q, tenantId)]);
  }

  /**
   * Zona de un tenant que todavía NO es el de la request.
   *
   * La usa el interceptor, que corre antes de que exista `requestContext`. **`q` es obligatorio**:
   * en ese momento la transacción de la request ya está abierta, y en PGlite la conexión es única,
   * así que una consulta suelta esperaría a que la tx cierre mientras la tx espera a la consulta.
   * Colgaba TODAS las requests autenticadas y ningún test lo vio: los tests no pasan por el
   * interceptor. Lo encontró levantar la app.
   */
  async timeZoneOf(q: Q, tenantId: string): Promise<string> {
    const cached = this.tzCache.get(tenantId);
    if (cached) return cached;
    const org = await q.one<{ timezone: string | null }>(`SELECT timezone FROM organizations WHERE id = $1`, [tenantId]);
    const tz = safeTimeZone(org?.timezone);
    this.tzCache.set(tenantId, tz);
    return tz;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      // Dentro de una request autenticada, todo va por su transacción (RLS activa)
      const q = requestContext.getStore()?.q;
      if (q) return await q.query<T>(sql, params);
      const res = await this.db.query<T>(sql, params);
      return res.rows;
    } catch (e) {
      throw translateDbError(e);
    }
  }

  async one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /**
   * Transacción real de PGlite: serializa el acceso a la conexión única
   * (otras requests esperan) y hace rollback automático si el callback lanza.
   * Nunca usar BEGIN/COMMIT manuales: con la conexión compartida, las queries
   * de otras requests se intercalarían dentro de la transacción ajena.
   */
  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    // Si la request ya corre dentro de su transacción (interceptor de auth),
    // se reutiliza: PGlite no soporta transacciones anidadas.
    const existing = requestContext.getStore()?.q;
    if (existing) return fn(existing);
    return this.db.transaction(async (t) => {
      /**
       * La traducción de errores va TAMBIÉN acá, no solo en `query()`.
       *
       * Se descubrió probando el modo espejo: `DbService.query` traduce, pero el handle `q` que
       * recibe el callback no traducía nada, y por ahí pasa medio sistema — todo el patrón `…InTx`
       * (`createEntryInTx`, `recordMovementInTx`, `revokeTenantSessionsInTx`) escribe con `q.query`
       * directo. Una escritura por ese camino durante una sesión de solo lectura devolvía el error
       * crudo de PostgreSQL como 500 «Internal server error», en vez del 403 que explica que estás
       * mirando la finca de un cliente y no podés modificarla.
       *
       * Con esto, las dos puertas a la base traducen igual y no hay que acordarse de cuál se usó.
       */
      const traducido = async <R>(sql: string, params?: unknown[]) => {
        try {
          return (await t.query<R>(sql, params)).rows;
        } catch (e) {
          throw translateDbError(e);
        }
      };
      const q: Q = {
        query: traducido,
        one: async <R>(sql: string, params?: unknown[]) => (await traducido<R>(sql, params))[0],
      };
      return fn(q);
    });
  }
}
