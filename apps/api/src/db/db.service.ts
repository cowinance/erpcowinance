import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDriver, PostgresDriver, type SqlDriver, type TxHandle } from './driver';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { bootstrapCatalogs, seedDemo } from './seed';
import { requestContext } from '../common/request-context';
import { RLS_TABLES, rlsMigration } from './rls';
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
  /** Primera finca del tenant actual (v0: finca única por tenant). */
  async defaultFarm(): Promise<string> {
    const t = this.tenant;
    const cached = this.farmCache.get(t);
    if (cached) return cached;
    const farm = await this.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [t]);
    if (!farm) throw new Error(`El tenant ${t} no tiene fincas`);
    this.farmCache.set(t, farm.id);
    return farm.id;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    // Dentro de una request autenticada, todo va por su transacción (RLS activa)
    const q = requestContext.getStore()?.q;
    if (q) return q.query<T>(sql, params);
    const res = await this.db.query<T>(sql, params);
    return res.rows;
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
      const q: Q = {
        query: async <R>(sql: string, params?: unknown[]) => (await t.query<R>(sql, params)).rows,
        one: async <R>(sql: string, params?: unknown[]) => (await t.query<R>(sql, params)).rows[0],
      };
      return fn(q);
    });
  }
}
