import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardHomeService } from './dashboard-home.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly home: DashboardHomeService,
  ) {}

  /** KPIs legacy (intacto): lo consume el Inicio actual y el móvil. */
  @Get('kpis')
  kpis() {
    return this.dashboard.kpis();
  }

  /** Inicio agregado (centro de control): prioridad + KPIs integrados + estado + agenda + actividad. */
  @Get('home')
  homeDashboard() {
    return this.home.home();
  }
}
