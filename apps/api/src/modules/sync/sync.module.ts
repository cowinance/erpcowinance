import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncHandlerRegistry } from './sync-handler.registry';
import { SyncConflictWriter } from './sync-conflict-writer';
import { SYNC_HANDLERS } from './sync-handler';
import { TreatmentSyncHandler } from './handlers/treatment-sync-handler';

@Module({
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncHandlerRegistry,
    SyncConflictWriter,
    TreatmentSyncHandler,
    { provide: SYNC_HANDLERS, useFactory: (treatments: TreatmentSyncHandler) => [treatments], inject: [TreatmentSyncHandler] },
  ],
})
export class SyncModule {}
