import { Module } from '@nestjs/common';
import { GeneticsController } from './genetics.controller';
import { EmbryosController } from './embryos.controller';
import { EvaluationsController } from './evaluations.controller';
import { CryoStorageController } from './cryo-storage.controller';
import { SemenService } from './semen.service';
import { EmbryosService } from './embryos.service';
import { EvaluationsService } from './evaluations.service';
import { CryoStorageService } from './cryo-storage.service';

/**
 * Genética: partidas de semen (G-1) + embriones + evaluaciones (G-2b) + ubicación criogénica
 * (GT-1). Saldos (pajuelas/embriones) como regla única. El consumo en inseminación / transferencia
 * (repro) reusa SemenService/EmbryosService.applyStrawsDelta (por eso ambos se exportan).
 */
@Module({
  controllers: [GeneticsController, EmbryosController, EvaluationsController, CryoStorageController],
  providers: [SemenService, EmbryosService, EvaluationsService, CryoStorageService],
  exports: [SemenService, EmbryosService, CryoStorageService],
})
export class GeneticsModule {}
