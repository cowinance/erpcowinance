import { Logger } from '@nestjs/common';

/**
 * Base URL del front para armar los enlaces que van por email.
 *
 * Vive en `common/` porque la necesitan dos módulos —`identity` (verificación y reset) e
 * `invitations`— y una copia por módulo se desincroniza justo cuando cambia el dominio.
 */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || 'http://localhost:3000';
}

/**
 * Sin `APP_BASE_URL`, el enlace apunta a `localhost:3000`: en el server el envío funciona, pero el
 * enlace muere en el teléfono de quien lo recibe. Es el síntoma más difícil de diagnosticar —el
 * correo llegó, así que el problema no parece del servidor—, y por eso se avisa al arrancar.
 */
export function avisarSiFaltaAppBaseUrl(contexto: string): void {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_BASE_URL?.trim())
    new Logger(contexto).warn(
      'APP_BASE_URL sin definir en producción: los enlaces que se mandan por email apuntan a ' +
        'http://localhost:3000 y no van a funcionar fuera del servidor. Configurala con tu dominio.',
    );
}
