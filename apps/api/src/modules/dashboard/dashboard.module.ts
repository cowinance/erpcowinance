import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardHomeService } from './dashboard-home.service';
import { TasksModule } from '../tasks/tasks.module';
import { AlertsModule } from '../alerts/alerts.module';
import { HealthModule } from '../health/health.module';
import { ReproModule } from '../repro/repro.module';

/**
 * Inicio: `/dashboard/kpis` (legacy, intacto) + `/dashboard/home` (agregado que COMPONE los KPIs
 * de tareas/alertas/sanidad/reproducción). Importa esos módulos para reusar sus servicios (no
 * duplica reglas). Sin ciclos: nadie importa DashboardModule.
 */
@Module({
  imports: [TasksModule, AlertsModule, HealthModule, ReproModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardHomeService],
})
export class DashboardModule {}
