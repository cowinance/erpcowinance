import { Module } from '@nestjs/common';
import { LandController } from './land.controller';
import { LandService } from './land.service';
import { MovementService } from './movement.service';

// MovementService: núcleo neutral de movimientos (P3 M-1.a). Se registra y exporta
// para que los canales (map/sync/REST) lo reutilicen en M-1.b–d. Inyecta la infra
// de sync (SyncVersionStore/ServerOriginChangesetWriter) del SyncRegistryModule (@Global).
@Module({ controllers: [LandController], providers: [LandService, MovementService], exports: [MovementService] })
export class LandModule {}
