import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.alerts.list(status);
  }

  @Get('kpis')
  kpis() {
    return this.alerts.kpis();
  }

  /** Motor de reglas: catálogo de reglas con su estado y umbral configurable por tenant. */
  @Get('rules')
  rules() {
    return this.alerts.listRules();
  }
  @Put('rules/:code')
  updateRule(@Param('code') code: string, @Body() body: any) {
    return this.alerts.updateRule(code, body);
  }

  @Post('evaluate')
  evaluate() {
    return this.alerts.evaluate();
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.alerts.setStatus(id, 'acknowledge');
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.alerts.setStatus(id, 'resolve');
  }

  @Post(':id/dismiss')
  dismiss(@Param('id') id: string) {
    return this.alerts.setStatus(id, 'dismiss');
  }
}
