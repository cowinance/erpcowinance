/**
 * Superficie mínima de consulta — la implementan DbService y sus transacciones.
 *
 * Vive en su propio archivo (y no en db.service.ts) para romper el ciclo
 * db.service ↔ request-context: request-context sólo necesita este tipo, no la
 * clase concreta. La dependencia queda unidireccional.
 */
export interface Q {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
}
