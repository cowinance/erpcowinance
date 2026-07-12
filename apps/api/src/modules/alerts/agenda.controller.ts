import { Controller, Get } from '@nestjs/common';
import { AlertsService } from './alerts.service';

/**
 * Agenda diaria (P4-1): `GET /agenda` — hechos accionables del hato, estructurados.
 * Path limpio (sin prefijo `alerts`) porque es un concepto de producto propio, pero la
 * lógica y las reglas siguen en `AlertsService` (fuente única). Solo lectura.
 */
@Controller()
export class AgendaController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('agenda')
  agenda() {
    return this.alerts.agenda();
  }
}
