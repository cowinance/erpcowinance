import { Module } from '@nestjs/common';
import { GeneticsController } from './genetics.controller';
import { EmbryosController } from './embryos.controller';
import { EvaluationsController } from './evaluations.controller';
import { SemenService } from './semen.service';
import { EmbryosService } from './embryos.service';
import { EvaluationsService } from './evaluations.service';

/**
 * Genética: partidas de semen (G-1) + embriones + evaluaciones (G-2b). Saldos (pajuelas/embriones)
 * como regla única. El consumo en inseminación / transferencia (repro) reusa
 * SemenService/EmbryosService.applyStrawsDelta (por eso ambos se exportan).
 */
@Module({
  controllers: [GeneticsController, EmbryosController, EvaluationsController],
  providers: [SemenService, EmbryosService, EvaluationsService],
  exports: [SemenService, EmbryosService],
})
export class GeneticsModule {}
