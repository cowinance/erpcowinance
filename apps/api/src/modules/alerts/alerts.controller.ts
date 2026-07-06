import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
