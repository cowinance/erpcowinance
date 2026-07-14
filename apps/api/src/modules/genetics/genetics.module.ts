import { Module } from '@nestjs/common';
import { GeneticsController } from './genetics.controller';
import { SemenService } from './semen.service';

/**
 * Genética (G-1): partidas de semen (pajuelas) con saldo materializado. Bounded context propio. El
 * consumo en inseminación (G-2) reusará SemenService.applyStrawsDelta.
 */
@Module({
  controllers: [GeneticsController],
  providers: [SemenService],
  exports: [SemenService], // G-2: consumo de pajuela en breeding_events.
})
export class GeneticsModule {}
