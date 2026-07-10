import { describe, it, expect, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { InvalidSex, InvalidWeight, InvalidTagNumber } from '@cowinance/domain';
import { DomainExceptionFilter } from './domain-exception.filter';

/**
 * Prueba de cableado (F3): un DomainError arbitrario, al pasar por el
 * filtro, produce EXACTAMENTE el mismo shape HTTP que hoy producen
 * BadRequestException({code,title}) — verificado empíricamente contra la
 * api corriendo antes de escribir este filtro.
 */
function mockHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('DomainExceptionFilter · traduce DomainError al contrato HTTP existente', () => {
  it('produce {code, title} con status 400, sin envoltorio adicional', () => {
    const filter = new DomainExceptionFilter();
    const { host, json, status } = mockHost();
    const error = new InvalidSex('X');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ code: 'domain.invalid_sex', title: error.message });
    expect(json).toHaveBeenCalledWith(expect.not.objectContaining({ statusCode: expect.anything() }));
  });

  it('funciona para cualquier DomainError concreto (prueba de cableado genérico, no acoplado a un VO)', () => {
    const filter = new DomainExceptionFilter();

    const cases: Array<[unknown, string]> = [
      [new InvalidWeight(-1, 'debe ser mayor que cero'), 'domain.invalid_weight'],
      [new InvalidTagNumber('', 'no puede estar vacía'), 'domain.invalid_tag_number'],
    ];

    for (const [error, code] of cases) {
      const { host, json, status } = mockHost();
      filter.catch(error as InstanceType<typeof InvalidWeight>, host);
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ code, title: (error as Error).message });
    }
  });
});
