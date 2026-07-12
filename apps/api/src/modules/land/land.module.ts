import { Module } from '@nestjs/common';
import { LandController } from './land.controller';
import { LandService } from './land.service';
import { MovementService } from './movement.service';
import { MovementSyncHandler } from './sync/movement-sync.handler';

// MovementService: núcleo neutral de movimientos (P3 M-1.a), reutilizado por map
// (M-1.b), sync (M-1.c, MovementSyncHandler) y REST (M-1.d). MovementSyncHandler se
// auto-registra en el SyncHandlerRegistry (@Global) para la tabla 'animal_movements'.
@Module({
  controllers: [LandController],
  providers: [LandService, MovementService, MovementSyncHandler],
  exports: [MovementService],
})
export class LandModule {}
