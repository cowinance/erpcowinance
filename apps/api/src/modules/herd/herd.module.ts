import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { WeighingSyncHandler } from './sync/weighing-sync.handler';
import { AnimalSyncHandler } from './sync/animal-sync.handler';

@Module({
  imports: [BillingModule],
  controllers: [HerdController],
  providers: [HerdService, AnimalWriteService, WeighingSyncHandler, AnimalSyncHandler],
  exports: [AnimalWriteService], // consumido por ImportModule para el preview (P2 3.5)
})
export class HerdModule {}
