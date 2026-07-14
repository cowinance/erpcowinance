import { Module } from '@nestjs/common';
import { MachineryController } from './machinery.controller';
import { MachineryService } from './machinery.service';

/**
 * Maquinaria (MQ-1): maestro de máquinas. Bounded context propio. Mantenimiento, combustible y horas
 * (MQ-2) cuelgan de este maestro.
 */
@Module({
  controllers: [MachineryController],
  providers: [MachineryService],
})
export class MachineryModule {}
