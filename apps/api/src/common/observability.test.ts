import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  currentRequestId,
  observabilityContext,
  requestObservability,
  resolveRequestId,
  routeLabel,
  tagActor,
} from './observability';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('genera uno cuando el cliente no manda nada', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
    expect(resolveRequestId(123)).toMatch(UUID);
  });

  // Respetar el id entrante es lo que hace que una traza cruce el borde web → proxy → API en vez
  // de cortarse en cada salto.
  it('respeta el id que ya trae la request', () => {
    expect(resolveRequestId('req-abc-123')).toBe('req-abc-123');
    expect(resolveRequestId(['req-abc-123', 'otro'])).toBe('req-abc-123');
  });

  // El valor viene de afuera y termina en los logs: saltos de línea o caracteres de control
  // permitirían inyectar líneas falsas en el recolector.
  it('sanea el id entrante', () => {
    expect(resolveRequestId('abc\ndef ghi<script>')).toBe('abcdefghiscript');
    expect(resolveRequestId('x'.repeat(200))).toHaveLength(64);
  });

  it('descarta un id demasiado corto para ser útil y genera uno propio', () => {
    expect(resolveRequestId('ab')).toMatch(UUID);
    expect(resolveRequestId('   ')).toMatch(UUID);
  });
});

describe('requestObservability', () => {
  function correr(headers: Record<string, unknown> = {}) {
    const setHeader = vi.fn();
    const once = vi.fn();
    let visto: { id?: string; path?: string } = {};
    const next = vi.fn(() => {
      visto = { id: currentRequestId(), path: observabilityContext.getStore()?.path };
    }) as unknown as NextFunction;
    requestObservability()(
      { headers, method: 'GET', originalUrl: '/v1/animals?limit=2' } as unknown as Request,
      { setHeader, once, statusCode: 200 } as unknown as Response,
      next,
    );
    return { setHeader, once, visto };
  }

  it('abre el contexto para todo lo que corra después', () => {
    const { visto } = correr();
    expect(visto.id).toMatch(UUID);
    expect(visto.path).toBe('/v1/animals?limit=2');
  });

  it('devuelve el id en la respuesta para que el cliente pueda citarlo', () => {
    const { setHeader, visto } = correr();
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, visto.id);
  });

  it('propaga el id entrante', () => {
    const { visto } = correr({ [REQUEST_ID_HEADER]: 'traza-del-proxy' });
    expect(visto.id).toBe('traza-del-proxy');
  });

  it('fuera de una request no hay contexto (y no lanza)', () => {
    expect(currentRequestId()).toBeUndefined();
    expect(() => tagActor('t', 'u')).not.toThrow();
  });

  // El log de acceso se emite en `finish`, no al terminar el handler: ahí el código de estado ya
  // es el definitivo (Nest fija el 201 de un POST después) y también salen las respuestas que
  // produjo un filtro de excepciones.
  it('registra el cierre en el evento finish de la respuesta', () => {
    expect(correr().once.mock.calls[0][0]).toBe('finish');
  });

  it('el interceptor de auth puede etiquetar el actor para el log de acceso', () => {
    const ctx = { requestId: 'r', method: 'GET', path: '/x', startedAt: 0 };
    observabilityContext.run(ctx, () => tagActor('tenant-1', 'user-1'));
    expect(ctx).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1' });
  });
});

describe('routeLabel', () => {
  // Lo que mantiene acotada la cardinalidad de las métricas: el PATRÓN, no la URL.
  it('usa el patrón de ruta, no la URL con ids', () => {
    expect(routeLabel({ route: { path: '/animals/:id' }, baseUrl: '/v1' })).toBe('/v1/animals/:id');
  });

  it('cae a una etiqueta fija cuando no hubo routing (404, error temprano)', () => {
    expect(routeLabel({})).toBe('sin_ruta');
  });
});
