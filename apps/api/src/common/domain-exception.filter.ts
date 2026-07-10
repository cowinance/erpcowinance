import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '@cowinance/domain';

/**
 * Traduce cualquier DomainError a la MISMA forma HTTP que ya producen las
 * excepciones de NestJS existentes en el proyecto: `{ code, title }`, sin
 * envoltorio adicional (verificado empíricamente: BadRequestException,
 * NotFoundException y UnauthorizedException con `{code,title}` hoy
 * serializan exactamente así, sin `statusCode`/`message`/`error`).
 *
 * Status fijo en 400: todo DomainError existente hoy (InvalidIdentifier,
 * InvalidTagNumber, InvalidWeight, InvalidSex) es una violación de
 * validación, equivalente a los BadRequestException que reemplazan. No se
 * construye un mapa código→status para casos que todavía no existen (YAGNI);
 * si un DomainError futuro necesita otro status, se decide al crearlo.
 *
 * Hoy ningún consumidor de apps/api lanza un DomainError (Value Objects sin
 * migrar, Opción B/F2) — este filtro no tiene disparador en producción
 * todavía. Es la plomería que F4 necesita para que, al migrar los VOs a los
 * servicios, la respuesta HTTP para el usuario no cambie.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json({ code: exception.code, title: exception.message });
  }
}
