import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [HealthController, PlansController],
  providers: [HealthService, PlansService],
})
export class HealthModule {}
