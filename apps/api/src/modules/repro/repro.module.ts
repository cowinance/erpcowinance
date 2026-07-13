import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ReproController } from './repro.controller';
import { ReproService } from './repro.service';
import { WeaningService } from './weaning.service';
import { BreedingEventSyncHandler } from './sync/breeding-event-sync.handler';
import { CalvingSyncHandler } from './sync/calving-sync.handler';
import { CalvingOffspringSyncHandler } from './sync/calving-offspring-sync.handler';
import { PregnancySyncHandler } from './sync/pregnancy-sync.handler';
import { WeaningSyncHandler } from './sync/weaning-sync.handler';

@Module({
  imports: [TasksModule],
  controllers: [ReproController],
  providers: [ReproService, WeaningService, BreedingEventSyncHandler, CalvingSyncHandler, CalvingOffspringSyncHandler, PregnancySyncHandler, WeaningSyncHandler],
})
export class ReproModule {}
