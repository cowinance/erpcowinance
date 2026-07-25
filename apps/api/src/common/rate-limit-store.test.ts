import { describe, it, expect, vi } from 'vitest';
import type { DbService } from '../db/db.service';
import {
  InMemoryRateLimitStore,
  PostgresRateLimitStore,
  resolveRateLimitStore,
} from './rate-limit-store';

const RULE = { limit: 3, windowMs: 60_000 };
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
const dbFalso = {} as DbService;

describe('InMemoryRateLimitStore', () => {
  it('aplica la ventana deslizante', async () => {
    const s = new InMemoryRateLimitStore();
    expect((await s.hit('k', RULE, 0)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 1)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 2)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 3)).allowed).toBe(false);
    expect((await s.hit('k', RULE, 60_001)).allowed).toBe(true);
  });
});

describe('PostgresRateLimitStore', () => {
  /** Doble de `DbService.tx` con una tabla `rate_limit_hits` en memoria. */
  function dbConTabla() {
    let filas: { key: string; at: number }[] = [];
    const db = {
      tx: async (fn: (q: any) => Promise<any>) =>
        fn({
          query: async (sql: string, params: any[]) => {
            if (sql.startsWith('DELETE')) {
              const corte = new Date(params[1]).getTime();
              filas = filas.filter((f) => !(f.key === params[0] && f.at <= corte));
              return [];
            }
            if (sql.startsWith('SELECT')) {
              const vivas = filas.filter((f) => f.key === params[0]);
              return [
                {
                  n: vivas.length,
                  primero: vivas.length ? new Date(Math.min(...vivas.map((f) => f.at))).toISOString() : null,
                },
              ];
            }
            filas.push({ key: params[0], at: new Date(params[1]).getTime() });
            return [];
          },
        }),
    } as unknown as DbService;
    return { db, filas: () => filas };
  }

  it('cuenta contra la tabla compartida y bloquea al llegar al límite', async () => {
    const { db } = dbConTabla();
    const s = new PostgresRateLimitStore(db);
    expect((await s.hit('k', RULE, 1000)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 1001)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 1002)).allowed).toBe(true);
    const bloqueado = await s.hit('k', RULE, 1003);
    expect(bloqueado.allowed).toBe(false);
    expect(bloqueado.retryAfterSeconds).toBe(60);
  });

  // Dos instancias distintas contra la MISMA tabla: el límite es uno solo. Es todo el punto de
  // haberlo sacado de la memoria del proceso.
  it('el límite es compartido entre instancias', async () => {
    const { db } = dbConTabla();
    const instanciaA = new PostgresRateLimitStore(db);
    const instanciaB = new PostgresRateLimitStore(db);
    expect((await instanciaA.hit('k', RULE, 0)).allowed).toBe(true);
    expect((await instanciaB.hit('k', RULE, 1)).allowed).toBe(true);
    expect((await instanciaA.hit('k', RULE, 2)).allowed).toBe(true);
    expect((await instanciaB.hit('k', RULE, 3)).allowed).toBe(false);
  });

  it('el intento rechazado no se registra (martillar no extiende el bloqueo)', async () => {
    const { db, filas } = dbConTabla();
    const s = new PostgresRateLimitStore(db);
    for (let i = 0; i < 10; i++) await s.hit('k', RULE, 1000 + i);
    expect(filas().length).toBe(3);
  });

  it('la ventana desliza: al vencer los intentos viejos vuelve a permitir', async () => {
    const { db } = dbConTabla();
    const s = new PostgresRateLimitStore(db);
    for (let i = 0; i < 3; i++) await s.hit('k', RULE, 1000);
    expect((await s.hit('k', RULE, 1500)).allowed).toBe(false);
    expect((await s.hit('k', RULE, 62_000)).allowed).toBe(true);
  });

  // Fail-OPEN a propósito: si la base no responde, /auth/login ya está caído. Rechazar acá no
  // protegería nada y dejaría el login bloqueado incluso después de que la base vuelva.
  it('si la base falla, degrada al contador en memoria en vez de rechazar todo', async () => {
    const db = { tx: vi.fn().mockRejectedValue(new Error('conexión caída')) } as unknown as DbService;
    const s = new PostgresRateLimitStore(db);
    expect((await s.hit('k', RULE, 0)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 1)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 2)).allowed).toBe(true);
    expect((await s.hit('k', RULE, 3)).allowed).toBe(false); // sigue limitando, solo que por proceso
  });
});

describe('resolveRateLimitStore', () => {
  // Con PGlite hay un solo proceso y la memoria alcanza; con PostgreSQL puede haber varias
  // instancias, y ahí contar en memoria multiplicaría el límite por la cantidad de instancias.
  it('postgres cuando hay DATABASE_URL, memoria cuando no', () => {
    expect(resolveRateLimitStore(dbFalso, env({ DATABASE_URL: 'postgres://x' })).kind).toBe('postgres');
    expect(resolveRateLimitStore(dbFalso, env({})).kind).toBe('memoria');
  });

  it('RATE_LIMIT_STORE fuerza la elección', () => {
    expect(resolveRateLimitStore(dbFalso, env({ DATABASE_URL: 'postgres://x', RATE_LIMIT_STORE: 'memory' })).kind).toBe(
      'memoria',
    );
    expect(resolveRateLimitStore(dbFalso, env({ RATE_LIMIT_STORE: 'postgres' })).kind).toBe('postgres');
  });

  it('un valor desconocido falla al arrancar, no en la primera request', () => {
    expect(() => resolveRateLimitStore(dbFalso, env({ RATE_LIMIT_STORE: 'redis' }))).toThrow(/RATE_LIMIT_STORE/);
  });
});
