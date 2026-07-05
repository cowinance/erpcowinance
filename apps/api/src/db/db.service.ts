import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { seed } from './seed';

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
   * Infra del motor de sync v0 (pendiente de incorporar al DDL canónico):
   * cursor global de changesets y versiones HLC por campo para el LWW.
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
  `;

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
    const farm = await this.db.query<{ id: string }>(
      `SELECT id FROM farms WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [this.tenantId],
    );
    this.farmId = farm.rows[0].id;
    const user = await this.db.query<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
    this.userId = user.rows[0].id;
    this.logger.log(`Contexto dev: tenant=${this.tenantId} farm=${this.farmId}`);
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

  /** Tenant/finca del contexto de desarrollo (en prod: middleware de auth + RLS). */
  get tenant(): string {
    return this.tenantId;
  }
  get farm(): string {
    return this.farmId;
  }
  get user(): string {
    return this.userId;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const res = await this.db.query<T>(sql, params);
    return res.rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }
}
