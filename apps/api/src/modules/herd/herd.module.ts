import { Module } from '@nestjs/common';
import { LandModule } from '../land/land.module';
import { BillingModule } from '../billing/billing.module';
import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';
import { LotsService } from './lots.service';
import { AnimalWriteService } from './animal-write.service';
import { AnimalStatusService } from './animal-status.service';
import { WeighingSyncHandler } from './sync/weighing-sync.handler';
import { AnimalSyncHandler } from './sync/animal-sync.handler';

@Module({
  imports: [BillingModule, LandModule], // LandModule: el alta ubica al animal por la regla única de movimientos
  controllers: [HerdController],
  providers: [HerdService, LotsService, AnimalWriteService, AnimalStatusService, WeighingSyncHandler, AnimalSyncHandler],
  exports: [AnimalWriteService, AnimalStatusService, HerdService, LotsService], // AnimalWriteService: ImportModule (P2 3.5). AnimalStatusService: Commerce ventas (C-3). Herd/Lots: OnboardingModule (O-3) crea el hato de ejemplo con los servicios REALES.
})
export class HerdModule {}
