import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { seed } from './seed';
import { requestContext } from '../common/request-context';

/** Superficie mínima de consulta — la implementan DbService y sus transacciones. */
export interface Q {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

/**
 * Capa de persistencia (dev): PGlite = PostgreSQL embebido en proceso.
 * Carga el DDL canónico completo (140 tablas, packages/db/cowinance_schema.sql).
 * En producción el mismo DDL corre sobre PostgreSQL 17 + PostGIS + TimescaleDB;
 * aquí los tipos geography se degradan a jsonb (PGlite no soporta PostGIS).
 */
@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private db!: PGlite;
  private tenantId!: string;
  private farmId!: string;
  private userId!: string;

  /**
   * Infra dev v0 (pendiente de incorporar al DDL canónico): cursor global de
   * changesets, versiones HLC por campo (LWW), credenciales de login y
   * refresh tokens con rotación.
   */
  private static readonly SYNC_MIGRATION = `
    CREATE SEQUENCE IF NOT EXISTS sync_changesets_server_seq;
    ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS server_seq bigint DEFAULT nextval('sync_changesets_server_seq');
    CREATE INDEX IF NOT EXISTS ix_sync_changesets_server_seq ON sync_changesets (tenant_id, server_seq);
    ALTER TABLE sync_conflicts ADD COLUMN IF NOT EXISTS detail text;
    CREATE TABLE IF NOT EXISTS sync_row_state (
      tenant_id uuid NOT NULL,
      table_name varchar(255) NOT NULL,
      row_id uuid NOT NULL,
      versions jsonb DEFAULT '{}' NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      PRIMARY KEY (tenant_id, table_name, row_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255);
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      jti uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      expires_at timestamptz NOT NULL,
      rotated_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL
    );
  `;

  /** Tablas de dominio con aislamiento por tenant vía Row-Level Security. */
  private static readonly RLS_TABLES = [
    'companies',
    'farms',
    'animals',
    'animal_identifiers',
    'animal_breeds',
    'animal_events',
    'weighings',
    'treatments',
    'vaccinations',
    'health_events',
    'health_plans',
    'mortalities',
    'breeding_events',
    'pregnancies',
    'calvings',
    'calving_offspring',
    'weanings',
    'lots',
    'paddocks',
    'products_veterinary',
    'alerts',
    'alert_rules',
    'notifications',
    'files',
    'attachments',
    'documents',
    'tasks',
    'calendar_events',
    // user_role_assignments queda SIN RLS: el login resuelve el tenant del
    // usuario ANTES de tener contexto de tenant (plano de identidad)
    'sync_devices',
    'sync_changesets',
    'sync_conflicts',
    'sync_row_state',
  ];

  /**
   * RLS activa y FORZADA (PGlite conecta como owner de las tablas; sin FORCE
   * el owner la saltea). La política compara tenant_id con la variable de
   * sesión app.tenant_id, que el interceptor de auth fija por request con
   * SET LOCAL dentro de la transacción. Sin variable → cero filas.
   */
  private static rlsMigration(): string {
    return DbService.RLS_TABLES.map(
      (t) => `
        ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON "${t}";
        CREATE POLICY tenant_isolation ON "${t}"
          USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
    ).join('\n');
  }

  async onModuleInit() {
    const dataDir = join(process.cwd(), '.data', 'pglite');
    mkdirSync(dataDir, { recursive: true });
    this.db = new PGlite(dataDir);
    await this.db.waitReady;
    const has = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'`,
    );
    if (has.rows[0].n === 0) {
      this.logger.log('Base vacía: cargando esquema canónico (140 tablas)…');
      await this.db.exec(this.loadSchemaSql());
      this.logger.log('Esquema cargado.');
    }
    await this.db.exec(DbService.SYNC_MIGRATION);
    await this.db.exec(DbService.rlsMigration());
    const orgs = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM organizations`);
    if (orgs.rows[0].n === 0) {
      this.logger.log('Sembrando datos demo…');
      await this.db.exec('BEGIN');
      try {
        await seed(this.db);
        await this.db.exec('COMMIT');
        this.logger.log('Seed completado.');
      } catch (err) {
        await this.db.exec('ROLLBACK');
        throw err;
      }
    }
    const org = await this.db.query<{ id: string }>(
      `SELECT id FROM organizations ORDER BY created_at LIMIT 1`,
    );
    this.tenantId = org.rows[0].id;
    // GUC de sesión: contexto por defecto para código fuera de request
    // (boot, seed). Las requests lo pisan con SET LOCAL en su transacción.
    await this.db.query(`SELECT set_config('app.tenant_id', $1, false)`, [this.tenantId]);
    const farm = await this.db.query<{ id: string }>(
      `SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [this.tenantId],
    );
    this.farmId = farm.rows[0].id;
    const user = await this.db.query<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
    this.userId = user.rows[0].id;
    this.logger.log(`Contexto dev: tenant=${this.tenantId} farm=${this.farmId} · RLS forzada en ${DbService.RLS_TABLES.length} tablas`);
  }

  private loadSchemaSql(): string {
    const candidates = [
      resolve(process.cwd(), '../../packages/db/cowinance_schema.sql'),
      resolve(__dirname, '../../../../packages/db/cowinance_schema.sql'),
    ];
    const path = candidates.find((p) => existsSync(p));
    if (!path) throw new Error('No se encontró packages/db/cowinance_schema.sql');
    const raw = readFileSync(path, 'utf8');
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
