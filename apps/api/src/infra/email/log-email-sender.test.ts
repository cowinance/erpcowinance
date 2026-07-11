import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { LogEmailSender } from './log-email-sender';

/**
 * Prueba de cableado del adaptador de dev (ADR-0011): el puerto recibe el
 * mensaje y el adaptador `log` lo registra con destinatario, asunto y cuerpo
 * (el cuerpo lleva el link con el token — así el e2e lo extrae del log).
 */
describe('LogEmailSender · adaptador de desarrollo', () => {
  it('registra destinatario, asunto y cuerpo (con el token)', async () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await new LogEmailSender().send({
      to: 'ana@finca.test',
      subject: 'Verificá tu email',
      text: 'Entrá a /verify-email?token=abc123',
    });

    expect(spy).toHaveBeenCalledOnce();
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain('ana@finca.test');
    expect(logged).toContain('Verificá tu email');
    expect(logged).toContain('token=abc123');

    spy.mockRestore();
  });
});
