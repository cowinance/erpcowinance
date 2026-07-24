import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { resolveCorsOrigin, resolveTrustProxy, securityHeaders } from './http-hardening';

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

describe('resolveCorsOrigin', () => {
  it('usa la lista explícita cuando está', () => {
    expect(resolveCorsOrigin(env({ CORS_ORIGINS: 'https://app.cowinance.com, https://admin.cowinance.com' }))).toEqual([
      'https://app.cowinance.com',
      'https://admin.cowinance.com',
    ]);
  });

  it('en desarrollo, sin lista, refleja el origen (puertos que cambian)', () => {
    expect(resolveCorsOrigin(env({ NODE_ENV: 'development' }))).toBe(true);
  });

  // El fix: en producción no se refleja cualquier origen por omisión.
  it('en producción, sin lista, no habilita CORS', () => {
    expect(resolveCorsOrigin(env({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('una lista vacía o de comas sueltas cuenta como ausente', () => {
    expect(resolveCorsOrigin(env({ NODE_ENV: 'production', CORS_ORIGINS: ' , , ' }))).toBe(false);
  });
});

describe('resolveTrustProxy', () => {
  it('desconfía por defecto: sin proxy, X-Forwarded-For lo elige el atacante', () => {
    expect(resolveTrustProxy(env({}))).toBe(false);
    expect(resolveTrustProxy(env({ TRUST_PROXY: 'false' }))).toBe(false);
    expect(resolveTrustProxy(env({ TRUST_PROXY: '0' }))).toBe(false);
  });

  it('acepta true (un salto) o una cantidad de saltos', () => {
    expect(resolveTrustProxy(env({ TRUST_PROXY: 'true' }))).toBe(1);
    expect(resolveTrustProxy(env({ TRUST_PROXY: '2' }))).toBe(2);
  });

  it('un valor inválido desconfía (fail-closed)', () => {
    expect(resolveTrustProxy(env({ TRUST_PROXY: 'sí' }))).toBe(false);
    expect(resolveTrustProxy(env({ TRUST_PROXY: '-1' }))).toBe(false);
  });
});

describe('securityHeaders', () => {
  function run(e: Record<string, string>) {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => void (headers[k] = v),
      removeHeader: (k: string) => void delete headers[k],
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    securityHeaders(env(e))({} as Request, res, next);
    return { headers, next };
  }

  it('fija las cabeceras base y continúa la cadena', () => {
    const { headers, next } = run({});
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(next).toHaveBeenCalledOnce();
  });

  // Si se activa sobre HTTP plano, el navegador deja el host inaccesible: tiene que ser explícito.
  it('HSTS solo con FORCE_HTTPS=true', () => {
    expect(run({}).headers['Strict-Transport-Security']).toBeUndefined();
    expect(run({ FORCE_HTTPS: 'true' }).headers['Strict-Transport-Security']).toContain('max-age=31536000');
  });
});
