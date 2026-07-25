import { Controller, Get, Headers, HttpException, HttpStatus, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../../db/db.service';
import { Public } from '../auth/public.decorator';
import { metrics } from '../../common/metrics';

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

  /**
   * Métricas en formato Prometheus.
   *
   * Exponerlas dice cosas sobre la operación (rutas, volumen, latencias) que no tienen por qué ser
   * públicas. La regla es fail-closed: en producción, si no hay `METRICS_TOKEN`, el endpoint **no
   * existe** (404, no 401: un 401 confirmaría que está ahí). Fuera de producción queda abierto,
   * porque ahí el destinatario es quien está desarrollando.
   */
  @Public()
  @Get('metrics')
  metrics(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN?.trim();
    const esProduccion = process.env.NODE_ENV === 'production';
    if (esProduccion && !token) throw new NotFoundException();
    if (token && authorization !== `Bearer ${token}`) throw new NotFoundException();

    const mem = process.memoryUsage();
    res.set({ 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(
      metrics.render({
        uptimeS: Math.round(process.uptime()),
        heapUsedBytes: mem.heapUsed,
        rssBytes: mem.rss,
      }),
    );
  }
}
