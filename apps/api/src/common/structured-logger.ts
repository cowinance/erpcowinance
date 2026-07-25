import type { LoggerService, LogLevel } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { observabilityContext } from './observability';
import { requestContext } from './request-context';

/**
 * Logger de producción: una línea JSON por evento, enriquecida con el contexto de la request.
 *
 * POR QUÉ: hasta ahora los logs eran el formato lindo de Nest, pensado para leer en una terminal.
 * En producción eso significa que un error no se puede correlacionar con la request que lo causó,
 * ni filtrar por tenant, ni agregar por nivel — el diagnóstico de un incidente sería leer texto
 * suelto. Con JSON, cualquier recolector (Loki, CloudWatch, Datadog) indexa `request_id`,
 * `tenant_id` y `level` sin parsear nada.
 *
 * En desarrollo se sigue usando el formato de Nest: ahí la terminal ES el destino y el JSON solo
 * estorbaría. La decisión la toma `LOG_FORMAT` (o `NODE_ENV`), no cada punto de log.
 */
export class StructuredLogger implements LoggerService {
  log(message: unknown, context?: string) {
    this.emit('info', message, context);
  }
  error(message: unknown, stack?: string, context?: string) {
    this.emit('error', message, context, stack);
  }
  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }

  private emit(level: LogLevel | 'info', message: unknown, context?: string, stack?: string) {
    process.stdout.write(JSON.stringify(logRecord(level, message, context, stack)) + '\n');
  }
}

/**
 * Construcción del registro, separada de la escritura para poder probarla. Los campos del contexto
 * solo aparecen si existen: una línea de arranque no tiene request ni tenant, y llenarlos con
 * `null` solo ensucia el índice del recolector.
 */
export function logRecord(
  level: string,
  message: unknown,
  context?: string,
  stack?: string,
  now: () => string = () => new Date().toISOString(),
): Record<string, unknown> {
  const obs = observabilityContext.getStore();
  // El contexto de auth es el más preciso mientras la request está viva; el de observabilidad lo
  // sobrevive (el log de acceso se emite con la transacción ya cerrada). Se prefiere el primero y
  // se cae al segundo.
  const auth = requestContext.getStore();
  const tenantId = auth?.tenantId ?? obs?.tenantId;
  const userId = auth?.userId ?? obs?.userId;
  return {
    ts: now(),
    level: level === 'verbose' ? 'debug' : level,
    msg: typeof message === 'string' ? message : safeStringify(message),
    ...(context ? { context } : {}),
    ...(obs ? { request_id: obs.requestId } : {}),
    ...(tenantId ? { tenant_id: tenantId } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(stack ? { stack } : {}),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Elige el logger. `LOG_FORMAT=json|pretty` manda; si no está, JSON en producción y el formato de
 * Nest en el resto.
 */
export function resolveLogger(env: NodeJS.ProcessEnv = process.env): LoggerService {
  const formato = env.LOG_FORMAT?.trim().toLowerCase() || (env.NODE_ENV === 'production' ? 'json' : 'pretty');
  return formato === 'json' ? new StructuredLogger() : new ConsoleLogger();
}
