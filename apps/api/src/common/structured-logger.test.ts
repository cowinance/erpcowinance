import { describe, it, expect } from 'vitest';
import { ConsoleLogger } from '@nestjs/common';
import { StructuredLogger, logRecord, resolveLogger } from './structured-logger';
import { observabilityContext } from './observability';
import { requestContext } from './request-context';

const ts = () => '2026-07-24T22:00:00.000Z';
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

describe('logRecord', () => {
  it('emite el mínimo cuando no hay request en curso (arranque, jobs)', () => {
    expect(logRecord('info', 'Cargando catálogos base…', 'DbService', undefined, ts)).toEqual({
      ts: ts(),
      level: 'info',
      msg: 'Cargando catálogos base…',
      context: 'DbService',
    });
  });

  // El punto de todo esto: poder pasar de una línea de log a la request que la causó, y filtrar
  // por tenant durante un incidente.
  it('enriquece con request_id, tenant_id y user_id cuando hay contexto', () => {
    const r = observabilityContext.run(
      { requestId: 'req-1', method: 'GET', path: '/v1/animals', startedAt: 0 },
      () =>
        requestContext.run({ userId: 'u-1', tenantId: 't-1', role: 'owner' }, () =>
          logRecord('error', 'algo falló', 'HerdService', 'Error: x\n  at y', ts),
        ),
    );
    expect(r).toEqual({
      ts: ts(),
      level: 'error',
      msg: 'algo falló',
      context: 'HerdService',
      request_id: 'req-1',
      tenant_id: 't-1',
      user_id: 'u-1',
      stack: 'Error: x\n  at y',
    });
  });

  // Una request pública (login, healthz) tiene id pero todavía no tiene tenant: los campos que no
  // existen se omiten en vez de ir en null, para no ensuciar el índice del recolector.
  it('omite los campos ausentes en vez de ponerlos en null', () => {
    const r = observabilityContext.run({ requestId: 'req-2', method: 'POST', path: '/v1/auth/login', startedAt: 0 }, () =>
      logRecord('warn', 'credenciales inválidas', undefined, undefined, ts),
    );
    expect(r).toEqual({ ts: ts(), level: 'warn', msg: 'credenciales inválidas', request_id: 'req-2' });
    expect('tenant_id' in r).toBe(false);
  });

  it('normaliza verbose a debug (Nest tiene cinco niveles; los recolectores, cuatro)', () => {
    expect(logRecord('verbose', 'x', undefined, undefined, ts).level).toBe('debug');
  });

  it('serializa mensajes que no son strings sin lanzar', () => {
    expect(logRecord('info', { a: 1 }, undefined, undefined, ts).msg).toBe('{"a":1}');
    const ciclico: Record<string, unknown> = {};
    ciclico.yo = ciclico;
    expect(() => logRecord('info', ciclico, undefined, undefined, ts)).not.toThrow();
  });
});

describe('resolveLogger', () => {
  it('JSON en producción, formato de Nest en desarrollo', () => {
    expect(resolveLogger(env({ NODE_ENV: 'production' }))).toBeInstanceOf(StructuredLogger);
    expect(resolveLogger(env({ NODE_ENV: 'development' }))).toBeInstanceOf(ConsoleLogger);
  });

  it('LOG_FORMAT manda sobre el entorno', () => {
    expect(resolveLogger(env({ NODE_ENV: 'development', LOG_FORMAT: 'json' }))).toBeInstanceOf(StructuredLogger);
    expect(resolveLogger(env({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' }))).toBeInstanceOf(ConsoleLogger);
  });
});

describe('StructuredLogger', () => {
  it('escribe una línea JSON por evento', () => {
    const escrito: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      escrito.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      new StructuredLogger().log('hola', 'Ctx');
    } finally {
      process.stdout.write = original;
    }
    expect(escrito).toHaveLength(1);
    expect(escrito[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(escrito[0])).toMatchObject({ level: 'info', msg: 'hola', context: 'Ctx' });
  });
});
