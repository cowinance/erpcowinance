import { PGlite } from '@electric-sql/pglite';
import { Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { dbSslFromEnv, warnsAboutPlaintext } from './db-ssl';

/**
 * Driver SQL — la app habla con la base a través de esta interfaz, no con PGlite directamente.
 *
 * POR QUÉ: en dev corremos sobre PGlite (Postgres embebido, cero instalación) pero producción es
 * PostgreSQL 17. Esa diferencia escondía un riesgo grande: PGlite conecta como SUPERUSUARIO, que
 * SALTEA la RLS — así que el aislamiento por tenant nunca se ejercía de verdad. Con esta capa la
 * MISMA app puede correr contra Postgres real (`DATABASE_URL`), con un rol restringido y la RLS
 * enforceada, sin tocar una línea de los módulos de negocio.
 *
 * La forma imita la de PGlite (`query` devuelve `{ rows }`) para que `DbService` no cambie.
 */

/**
 * Cuántas filas CAMBIÓ una sentencia. Cero para las lecturas.
 *
 * Lo normalizan los dos drivers porque los dos lo dicen distinto, y confiar en cualquiera de las
 * dos formas crudas sale mal:
 *
 *  · PGlite expone `affectedRows`, y ya vale 0 en un `SELECT`.
 *  · `pg` expone `rowCount`, que en un `SELECT` es **cuántas filas devolvió**. Tomarlo como
 *    «escribió» habría dado que toda lectura con resultados es una escritura — invisible en dev,
 *    porque en dev corre PGlite. Por eso acá se mira además `command`.
 *
 * Antes esta capa devolvía solo `rows` y tiraba el resto, así que el dato no llegaba a `DbService`.
 */
export type QueryResult<T> = { rows: T[]; affectedRows: number };

/** Las sentencias que cambian datos, según el `command` que informa `pg`. */
const COMANDOS_DE_ESCRITURA = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY']);

export function filasCambiadas(r: { command?: string; rowCount?: number | null; affectedRows?: number }): number {
  if (typeof r?.affectedRows === 'number') return r.affectedRows;
  return r?.command && COMANDOS_DE_ESCRITURA.has(r.command) ? (r.rowCount ?? 0) : 0;
}

export interface TxHandle {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface SqlDriver {
  /** Nombre para logs. */
  readonly kind: 'pglite' | 'postgres';
  ready(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Ejecuta SQL de varias sentencias (DDL, migraciones). Sin parámetros. */
  exec(sql: string): Promise<void>;
  /** Transacción real; rollback automático si el callback lanza. */
  transaction<T>(fn: (t: TxHandle) => Promise<T>): Promise<T>;
  /**
   * Conexión ÚNICA y persistente para el arranque (DDL + seed). Importa con Postgres real: el
   * seed usa `set_config(..., false)` a nivel SESIÓN, y con un pool cada query podría caer en una
   * conexión distinta y perder el ajuste. En PGlite es la misma conexión de siempre.
   */
  bootHandle(): Promise<TxHandle & { release: () => void }>;
  close(): Promise<void>;
}

/** Dev por defecto: PostgreSQL embebido en proceso, sin instalar nada. */
export class PGliteDriver implements SqlDriver {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}
  ready() {
    return this.db.waitReady.then(() => undefined);
  }
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const r = await this.db.query<T>(sql, params);
    return { rows: r.rows as T[], affectedRows: filasCambiadas(r as any) };
  }
  async exec(sql: string) {
    await this.db.exec(sql);
  }
  transaction<T>(fn: (t: TxHandle) => Promise<T>): Promise<T> {
    return this.db.transaction(async (t) => fn(t as unknown as TxHandle)) as Promise<T>;
  }
  async bootHandle() {
    // Conexión única por definición: se devuelve el mismo driver.
    return { query: this.query.bind(this), release: () => {} } as TxHandle & { release: () => void };
  }
  async close() {
    await this.db.close();
  }
}

/**
 * PostgreSQL real. `url` es la conexión de SERVICIO (rol restringido, con RLS enforceada);
 * `adminUrl` —si se indica— se usa solo para el DDL de arranque, que necesita privilegios.
 * Así se separa lo mismo que en producción: migrar con credenciales elevadas, servir con las mínimas.
 */
export class PostgresDriver implements SqlDriver {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private readonly adminPool: Pool;

  constructor(url: string, adminUrl?: string) {
    // TLS explícito (DATABASE_SSL_CA) por encima de lo que diga la cadena: contra una base
    // gestionada, `sslmode=require` se interpreta como verificación estricta y falla porque falta la
    // CA del proveedor. Ver `db-ssl.ts`.
    const ssl = dbSslFromEnv();
    const logger = new Logger('PostgresDriver');
    if (ssl) logger.log('TLS con verificación de certificado (DATABASE_SSL_CA)');
    else if (warnsAboutPlaintext(url, ssl))
      logger.warn(
        'La base es un host REMOTO y la conexión no pide TLS: la contraseña y los datos de las fincas ' +
          'viajan en claro. Pasá la CA del proveedor en DATABASE_SSL_CA.',
      );

    this.pool = new Pool({ connectionString: url, max: 10, ...(ssl ? { ssl } : {}) });
    this.adminPool = adminUrl ? new Pool({ connectionString: adminUrl, max: 2, ...(ssl ? { ssl } : {}) }) : this.pool;
  }

  async ready() {
    await this.pool.query('SELECT 1');
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    const r = await this.pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[], affectedRows: filasCambiadas(r as any) };
  }

  /** DDL/migraciones: van por la conexión administrativa (multi-sentencia, protocolo simple). */
  async exec(sql: string) {
    await this.adminPool.query(sql);
  }

  async transaction<T>(fn: (t: TxHandle) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn({
        query: async <R>(sql: string, params?: unknown[]) => {
          const r = await client.query(sql, params as unknown[]);
          return { rows: r.rows as R[], affectedRows: filasCambiadas(r as any) };
        },
      });
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Handle de arranque sobre la conexión ADMIN, tomando un cliente fijo (ver doc de la interfaz). */
  async bootHandle() {
    const client = await this.adminPool.connect();
    return {
      query: async <R>(sql: string, params?: unknown[]) => {
        const r = await client.query(sql, params as unknown[]);
        return { rows: r.rows as R[], affectedRows: filasCambiadas(r as any) };
      },
      release: () => client.release(),
    };
  }

  async close() {
    await this.pool.end();
    if (this.adminPool !== this.pool) await this.adminPool.end();
  }
}
