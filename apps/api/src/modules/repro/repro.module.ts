import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { GeneticsModule } from '../genetics/genetics.module';
import { ReproController } from './repro.controller';
import { ReproService } from './repro.service';
import { ProtocolService } from './protocol.service';
import { ReproDashboardService } from './repro-dashboard.service';
import { ReproReportsController } from './repro-reports.controller';
import { ReproReportsService } from './repro-reports.service';
import { WeaningService } from './weaning.service';
import { ServicePlanService } from './service-plan.service';
import { ServicePlanController } from './service-plan.controller';
import { BreedingEventSyncHandler } from './sync/breeding-event-sync.handler';
import { CalvingSyncHandler } from './sync/calving-sync.handler';
import { CalvingOffspringSyncHandler } from './sync/calving-offspring-sync.handler';
import { PregnancySyncHandler } from './sync/pregnancy-sync.handler';
import { WeaningSyncHandler } from './sync/weaning-sync.handler';

@Module({
  imports: [TasksModule, GeneticsModule],
  controllers: [ReproController, ReproReportsController, ServicePlanController],
  providers: [ReproService, ReproReportsService, WeaningService, ServicePlanService, BreedingEventSyncHandler, CalvingSyncHandler, CalvingOffspringSyncHandler, PregnancySyncHandler, WeaningSyncHandler, ProtocolService, ReproDashboardService],
  exports: [ReproService, ServicePlanService], // AlertsModule reusa `statusAlerts` (mismas reglas de estado, sin duplicar SQL).
})
export class ReproModule {}
