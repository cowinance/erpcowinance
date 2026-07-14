import { Module } from '@nestjs/common';
import { MachineryController } from './machinery.controller';
import { MachineryLogsController } from './machinery-logs.controller';
import { MachineryService } from './machinery.service';
import { MachineryLogsService } from './machinery-logs.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Maquinaria: maestro (MQ-1) + mantenimiento/combustible (MQ-2). Depende (unidireccional) de Inventory
 * para descontar el combustible del stock por `consumption`.
 */
@Module({
  imports: [InventoryModule],
  controllers: [MachineryController, MachineryLogsController],
  providers: [MachineryService, MachineryLogsService],
})
export class MachineryModule {}
