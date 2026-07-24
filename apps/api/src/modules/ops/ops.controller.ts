import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Public } from '../auth/public.decorator';

/**
 * Sondas de plataforma. Todo orquestador (Kubernetes, ECS, Railway, Fly, Render) necesita dos
 * señales DISTINTAS y hasta ahora no había ninguna: sin `readyz` el balanceador manda tráfico a
 * una instancia que todavía está cargando el esquema, y sin `healthz` un proceso colgado nunca
 * se reinicia.
 *
 * - `healthz` (liveness): ¿el proceso responde? NO toca la base a propósito — si un incidente de
 *   base marcara "muerto" al proceso, el orquestador lo reiniciaría en loop y empeoraría todo.
 * - `readyz` (readiness): ¿puede atender? Verifica la base. Falla → sale de la rotación, sin
 *   reiniciarse.
 *
 * Ambas públicas: la sonda del orquestador no tiene token.
 */
@Controller()
export class OpsController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('healthz')
  healthz() {
    return { status: 'ok', uptime_s: Math.round(process.uptime()) };
  }

  @Public()
  @Get('readyz')
  async readyz() {
    try {
      await this.db.query('SELECT 1');
    } catch (e) {
      throw new HttpException(
        { code: 'ops.not_ready', title: 'La base de datos no responde', detail: (e as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ready' };
  }
}
