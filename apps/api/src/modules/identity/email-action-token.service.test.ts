import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DbService } from '../../db/db.service';
import { EmailActionTokenService } from './email-action-token.service';
import { hashActionToken } from '../../common/action-token';

/**
 * Ciclo de vida del token de acción por email (P1.2.1) contra un PGlite real
 * (in-memory) — verifica la semántica SQL (single-use atómico, expiración,
 * supersede, purpose no intercambiable), no solo el shape de las queries.
 */
const DDL = `
  CREATE TABLE email_action_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    purpose varchar(32) NOT NULL,
    token_hash varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
  );
`;
const USER = '11111111-1111-1111-1111-111111111111';

async function setup() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(DDL);
  const db = {
    query: async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows,
    one: async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows[0],
  } as unknown as DbService;
  return { pg, svc: new EmailActionTokenService(db) };
}

describe('EmailActionTokenService · tokens one-time con hash', () => {
  let pg: PGlite;
  let svc: EmailActionTokenService;
  beforeEach(async () => {
    ({ pg, svc } = await setup());
  });

  it('emite un token en claro y guarda solo su hash', async () => {
    const token = await svc.issue(USER, 'verify_email');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    const rows = (await pg.query<{ token_hash: string }>(`SELECT token_hash FROM email_action_tokens`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashActionToken(token));
    expect(rows[0].token_hash).not.toBe(token);
  });

  it('consume devuelve el user_id y valida el propósito', async () => {
    const token = await svc.issue(USER, 'verify_email');
    expect(await svc.consume(token, 'verify_email')).toBe(USER);
  });

  it('single-use: el segundo consumo del mismo token falla', async () => {
    const token = await svc.issue(USER, 'password_reset');
    expect(await svc.consume(token, 'password_reset')).toBe(USER);
    expect(await svc.consume(token, 'password_reset')).toBeNull();
  });

  it('purpose no intercambiable: verify no sirve como reset', async () => {
    const token = await svc.issue(USER, 'verify_email');
    expect(await svc.consume(token, 'password_reset')).toBeNull();
    // sigue válido para su propósito real
    expect(await svc.consume(token, 'verify_email')).toBe(USER);
  });

  it('rechaza un token expirado', async () => {
    const token = await svc.issue(USER, 'password_reset');
    await pg.query(`UPDATE email_action_tokens SET expires_at = now() - interval '1 second'`);
    expect(await svc.consume(token, 'password_reset')).toBeNull();
  });

  it('rechaza un token inexistente / arbitrario', async () => {
    await svc.issue(USER, 'verify_email');
    expect(await svc.consume('token-que-no-existe', 'verify_email')).toBeNull();
  });

  it('supersede: emitir de nuevo invalida el token anterior del mismo propósito', async () => {
    const first = await svc.issue(USER, 'verify_email');
    const second = await svc.issue(USER, 'verify_email');
    expect(await svc.consume(first, 'verify_email')).toBeNull(); // superado
    expect(await svc.consume(second, 'verify_email')).toBe(USER); // el vigente
  });
});
