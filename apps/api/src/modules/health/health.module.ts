import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LandModule } from '../land/land.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MortalityService } from './mortality.service';
import { TreatmentService } from './treatment.service';
import { VaccinationService } from './vaccination.service';
import { ClinicalCaseController } from './clinical-case.controller';
import { ClinicalCaseService } from './clinical-case.service';
import { HospitalizationController } from './hospitalization.controller';
import { HospitalizationService } from './hospitalization.service';
import { HealthReportsController } from './health-reports.controller';
import { HealthReportsService } from './health-reports.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { MortalitySyncHandler } from './sync/mortality-sync.handler';
import { TreatmentSyncHandler } from './sync/treatment-sync.handler';
import { VaccinationSyncHandler } from './sync/vaccination-sync.handler';

@Module({
  imports: [TasksModule, InventoryModule, LandModule],
  controllers: [HealthController, PlansController, ClinicalCaseController, HospitalizationController, HealthReportsController],
  providers: [
    HealthService, MortalityService, TreatmentService, VaccinationService, ClinicalCaseService, HospitalizationService, HealthReportsService, PlansService,
    MortalitySyncHandler, TreatmentSyncHandler, VaccinationSyncHandler,
  ],
  // ClinicalCaseService: Laboratorio abre el caso desde el resultado (Fase 3.1) reusando ESTA regla
  // —timeline del caso + evento del animal + máquina de estados—, en vez de insertar por su cuenta.
  exports: [HealthService, ClinicalCaseService], // Inicio (DashboardHomeService) compone health.kpis() sin duplicar reglas.
})
export class HealthModule {}
