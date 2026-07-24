import { describe, it, expect } from 'vitest';
import { smtpConfigFromEnv } from './smtp-email-sender';

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
const MINIMO = { SMTP_HOST: 'smtp.ejemplo.com', SMTP_FROM: 'Cowinance <no-reply@ejemplo.com>' };

describe('smtpConfigFromEnv', () => {
  it('toma los valores mínimos y completa el puerto por defecto', () => {
    expect(smtpConfigFromEnv(env(MINIMO))).toEqual({
      host: 'smtp.ejemplo.com',
      port: 587,
      secure: false,
      user: undefined,
      pass: undefined,
      from: 'Cowinance <no-reply@ejemplo.com>',
    });
  });

  // Configurar mal el SMTP no se descubre hasta que un usuario real no puede recuperar su
  // contraseña: conviene que el proceso lo diga al arrancar.
  it.each([
    ['SMTP_HOST', { SMTP_FROM: MINIMO.SMTP_FROM }],
    ['SMTP_FROM', { SMTP_HOST: MINIMO.SMTP_HOST }],
  ])('falla si falta %s', (falta, e) => {
    expect(() => smtpConfigFromEnv(env(e))).toThrow(new RegExp(falta));
  });

  it('falla si hay usuario sin contraseña (la autenticación moriría en el primer envío)', () => {
    expect(() => smtpConfigFromEnv(env({ ...MINIMO, SMTP_USER: 'u' }))).toThrow(/SMTP_PASS/);
  });

  it('TLS implícito en el 465, STARTTLS en el 587 (convención de los proveedores)', () => {
    expect(smtpConfigFromEnv(env({ ...MINIMO, SMTP_PORT: '465' })).secure).toBe(true);
    expect(smtpConfigFromEnv(env({ ...MINIMO, SMTP_PORT: '587' })).secure).toBe(false);
  });

  it('SMTP_SECURE pisa la convención del puerto', () => {
    expect(smtpConfigFromEnv(env({ ...MINIMO, SMTP_PORT: '587', SMTP_SECURE: 'true' })).secure).toBe(true);
    expect(smtpConfigFromEnv(env({ ...MINIMO, SMTP_PORT: '465', SMTP_SECURE: 'false' })).secure).toBe(false);
  });

  it('rechaza un puerto inválido', () => {
    for (const port of ['0', '99999', 'quinientos'])
      expect(() => smtpConfigFromEnv(env({ ...MINIMO, SMTP_PORT: port }))).toThrow(/SMTP_PORT inválido/);
  });

  it('acepta usuario y contraseña completos', () => {
    const c = smtpConfigFromEnv(env({ ...MINIMO, SMTP_USER: 'apikey', SMTP_PASS: 'secreto' }));
    expect(c.user).toBe('apikey');
    expect(c.pass).toBe('secreto');
  });
});
