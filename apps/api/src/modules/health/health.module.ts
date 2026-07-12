import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MortalityService } from './mortality.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { MortalitySyncHandler } from './sync/mortality-sync.handler';
import { TreatmentSyncHandler } from './sync/treatment-sync.handler';
import { VaccinationSyncHandler } from './sync/vaccination-sync.handler';

@Module({
  imports: [TasksModule],
  controllers: [HealthController, PlansController],
  providers: [HealthService, MortalityService, PlansService, MortalitySyncHandler, TreatmentSyncHandler, VaccinationSyncHandler],
})
export class HealthModule {}
