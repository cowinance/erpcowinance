import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Migraciones de esquema versionadas.
 *
 * ANTES: la evolución del esquema vivía en constantes de DDL idempotente dentro de
 * `db.service.ts` (7 y creciendo) que se ejecutaban COMPLETAS en cada arranque. Funcionaba,
 * pero no había forma de saber en qué estado estaba una base de producción, ni orden
 * garantizado, ni manera de detectar que alguien editó una migración ya aplicada — que es el
 * error más caro de todos, porque el cambio se aplica en las bases nuevas y NO en las viejas,
 * y las dos divergen en silencio.
 *
 * AHORA: archivos numerados en `packages/db/migrations/`, una tabla `schema_migrations` con la
 * versión y el checksum de cada una, y un corredor que aplica solo lo pendiente.
 *
 * CONVIVENCIA CON LO QUE YA ESTÁ APLICADO: una base existente (dev o producción) no tiene
 * `schema_migrations`, así que el corredor ve TODO como pendiente. Por eso las migraciones
 * heredadas son —y siguen siendo— idempotentes (`IF NOT EXISTS`, `DROP … IF EXISTS` antes de
 * crear): la primera corrida las re-aplica sin efecto y las registra. De ahí en adelante, cada
 * una corre exactamente una vez.
 *
 * LO QUE NO ES UNA MIGRACIÓN: las políticas de RLS. Son CONVERGENTES — se generan desde
 * `RLS_TABLES` y tienen que re-aplicarse cada vez que esa lista cambia, que es justamente lo
 * que hace útil al guardarraíl (agregar una tabla a la lista crea su policy sola). Versionarlas
 * rompería esa propiedad, así que `rlsMigration()` sigue corriendo en cada arranque.
 */
export interface Migration {
  /** Prefijo numérico del archivo: `0003`. Es la clave en `schema_migrations`. */
  version: string;
  /** Nombre legible: `movements_and_push`. */
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationDriver {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

export const MIGRATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version varchar(64) PRIMARY KEY,
    name varchar(255) NOT NULL,
    checksum varchar(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    duration_ms int
  );
`;

/** Versión reservada para el DDL canónico completo (`packages/db/cowinance_schema.sql`). */
export const BASELINE_VERSION = '0000';

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 64);
}

const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/**
 * Lee y ORDENA las migraciones del directorio. El orden es el del prefijo numérico, no el del
 * filesystem: `readdirSync` no garantiza orden y una migración fuera de secuencia rompería el
 * esquema de forma difícil de diagnosticar.
 */
export function loadMigrations(dir: string): Migration[] {
  const files = readdirSync(dir).filter((f) => FILENAME.test(f));
  const migrations = files.map((file) => {
    const [, version, name] = FILENAME.exec(file)!;
    const sql = readFileSync(resolve(dir, file), 'utf8');
    return { version, name, sql, checksum: checksumOf(sql) };
  });
  migrations.sort((a, b) => a.version.localeCompare(b.version));

  const duplicated = migrations.find((m, i) => i > 0 && migrations[i - 1].version === m.version);
  if (duplicated)
    throw new Error(`Dos migraciones comparten la versión ${duplicated.version}: el orden sería ambiguo.`);
  if (migrations.some((m) => m.version === BASELINE_VERSION))
    throw new Error(`La versión ${BASELINE_VERSION} está reservada para el esquema canónico.`);
  return migrations;
}

export interface AppliedMigration {
  version: string;
  checksum: string;
}

export interface MigrationRunResult {
  applied: Migration[];
  skipped: number;
}

/**
 * Aplica lo pendiente. Cada migración va en su propia transacción: si falla a la mitad, no queda
 * medio esquema aplicado. (Consecuencia: no se puede usar `CREATE INDEX CONCURRENTLY`, que
 * Postgres prohíbe dentro de una transacción. Si alguna vez hace falta, será una migración con
 * marca propia, no un cambio silencioso de esta regla.)
 *
 * Un checksum distinto al registrado ABORTA el arranque. Es deliberadamente ruidoso: significa
 * que se editó una migración ya aplicada, y entonces esta base y una base nueva ya no describen
 * el mismo esquema. La corrección es una migración nueva, nunca editar la vieja.
 */
export async function runMigrations(
  db: MigrationDriver,
  migrations: Migration[],
  log: (message: string) => void = () => {},
): Promise<MigrationRunResult> {
  await db.exec(MIGRATIONS_TABLE_DDL);
  const { rows: appliedRows } = await db.query<AppliedMigration>(
    `SELECT version, checksum FROM schema_migrations`,
  );
  const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));

  const drifted = migrations.filter((m) => applied.has(m.version) && applied.get(m.version) !== m.checksum);
  if (drifted.length > 0)
    throw new Error(
      `Migraciones ya aplicadas que cambiaron en disco: ${drifted.map((m) => `${m.version}_${m.name}`).join(', ')}. ` +
        'Una migración aplicada es historia: editarla hace que esta base y una base nueva describan ' +
        'esquemas distintos sin que nada avise. Revertí el archivo y escribí una migración nueva.',
    );

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return { applied: [], skipped: migrations.length };

  log(`Migraciones pendientes: ${pending.length} (aplicadas: ${applied.size})`);
  for (const m of pending) {
    const started = Date.now();
    try {
      await db.exec(`BEGIN;\n${m.sql}\nCOMMIT;`);
    } catch (e) {
      await db.exec('ROLLBACK;').catch(() => {});
      throw new Error(`Migración ${m.version}_${m.name} falló: ${(e as Error).message}`);
    }
    await db.query(
      `INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1,$2,$3,$4)`,
      [m.version, m.name, m.checksum, Date.now() - started],
    );
    log(`  ✓ ${m.version}_${m.name} (${Date.now() - started} ms)`);
  }
  return { applied: pending, skipped: migrations.length - pending.length };
}

/** Registra el esquema canónico como versión 0000. Idempotente. */
export async function recordBaseline(db: MigrationDriver, checksum: string): Promise<void> {
  await db.exec(MIGRATIONS_TABLE_DDL);
  await db.query(
    `INSERT INTO schema_migrations (version, name, checksum)
     VALUES ($1, $2, $3)
     ON CONFLICT (version) DO NOTHING`,
    [BASELINE_VERSION, 'baseline_cowinance_schema', checksum],
  );
}

/**
 * Resuelve una ruta dentro de `packages/db`. Dos candidatos porque el proceso corre desde dos
 * lugares distintos: `apps/api` en desarrollo (cwd) y `dist/` compilado en el contenedor
 * (__dirname). Si no aparece en ninguno, es mejor fallar acá con el detalle que arrancar sin
 * esquema.
 */
export function resolveDbPath(relative: string): string {
  const candidates = [
    resolve(process.cwd(), '../../packages/db', relative),
    resolve(process.cwd(), 'packages/db', relative),
    resolve(__dirname, '../../../../packages/db', relative),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found)
    throw new Error(`No se encontró packages/db/${relative}. Buscado en:\n  ${candidates.join('\n  ')}`);
  return found;
}
