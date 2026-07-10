import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { TreatmentSyncHandler } from './sync/treatment-sync.handler';
import { VaccinationSyncHandler } from './sync/vaccination-sync.handler';

@Module({
  controllers: [HealthController, PlansController],
  providers: [HealthService, PlansService, TreatmentSyncHandler, VaccinationSyncHandler],
})
export class HealthModule {}
