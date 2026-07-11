import { Module } from '@nestjs/common';
import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { WeighingSyncHandler } from './sync/weighing-sync.handler';
import { AnimalSyncHandler } from './sync/animal-sync.handler';

@Module({
  controllers: [HerdController],
  providers: [HerdService, AnimalWriteService, WeighingSyncHandler, AnimalSyncHandler],
})
export class HerdModule {}
