import { Module } from '@nestjs/common';
import { GeneticsController } from './genetics.controller';
import { EmbryosController } from './embryos.controller';
import { EvaluationsController } from './evaluations.controller';
import { CryoStorageController } from './cryo-storage.controller';
import { StrawsController } from './straws.controller';
import { NitrogenController } from './nitrogen.controller';
import { SemenService } from './semen.service';
import { EmbryosService } from './embryos.service';
import { EvaluationsService } from './evaluations.service';
import { CryoStorageService } from './cryo-storage.service';
import { StrawsService } from './straws.service';
import { SireEvaluationController } from './sire-evaluation.controller';
import { InbreedingService } from './inbreeding.service';
import { DamEvaluationService } from './dam-evaluation.service';
import { InbreedingController } from './inbreeding.controller';
import { SireEvaluationService } from './sire-evaluation.service';
import { NitrogenService } from './nitrogen.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Genética: partidas de semen (G-1) + embriones + evaluaciones (G-2b) + ubicación criogénica
 * (GT-1) + pajuelas con identidad (GT-2) + nitrógeno del termo (GT-4).
 *
 * Desde GT-2 la regla única del stock vive en `StrawsService`: la ÚNICA mutación posible es una
 * transición de estado de una unidad, y el saldo se cuenta. `applyStrawsDelta` sobrevive con la
 * misma firma —reproducción y la web la usan— pero por dentro crea o consume unidades.
 */
@Module({
  imports: [InventoryModule],
  controllers: [GeneticsController, EmbryosController, EvaluationsController, CryoStorageController, StrawsController, NitrogenController, SireEvaluationController, InbreedingController],
  providers: [SemenService, EmbryosService, EvaluationsService, CryoStorageService, StrawsService, NitrogenService, SireEvaluationService, InbreedingService, DamEvaluationService],
  exports: [SemenService, EmbryosService, CryoStorageService, StrawsService, NitrogenService, SireEvaluationService, InbreedingService, DamEvaluationService],
})
export class GeneticsModule {}
