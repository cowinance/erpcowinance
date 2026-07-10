import { Module } from '@nestjs/common';
import { ReproController } from './repro.controller';
import { ReproService } from './repro.service';
import { BreedingEventSyncHandler } from './sync/breeding-event-sync.handler';
import { CalvingSyncHandler } from './sync/calving-sync.handler';
import { CalvingOffspringSyncHandler } from './sync/calving-offspring-sync.handler';

@Module({
  controllers: [ReproController],
  providers: [ReproService, BreedingEventSyncHandler, CalvingSyncHandler, CalvingOffspringSyncHandler],
})
export class ReproModule {}
