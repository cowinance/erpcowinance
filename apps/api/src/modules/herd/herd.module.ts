import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { AnimalStatusService } from './animal-status.service';
import { WeighingSyncHandler } from './sync/weighing-sync.handler';
import { AnimalSyncHandler } from './sync/animal-sync.handler';

@Module({
  imports: [BillingModule],
  controllers: [HerdController],
  providers: [HerdService, AnimalWriteService, AnimalStatusService, WeighingSyncHandler, AnimalSyncHandler],
  exports: [AnimalWriteService, AnimalStatusService], // AnimalWriteService: ImportModule (P2 3.5). AnimalStatusService: Commerce ventas (C-3).
})
export class HerdModule {}
