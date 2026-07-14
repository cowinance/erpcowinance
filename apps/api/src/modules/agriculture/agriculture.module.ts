import { Module } from '@nestjs/common';
import { AgricultureController } from './agriculture.controller';
import { CropOperationsController } from './crop-operations.controller';
import { CropsService } from './crops.service';
import { CropOperationsService } from './crop-operations.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Agricultura: cultivos (AG-1) + labores/cosechas (AG-2). Depende (unidireccional) de Inventory para
 * descontar insumos por `consumption` en las labores y sumar el grano cosechado al stock.
 */
@Module({
  imports: [InventoryModule],
  controllers: [AgricultureController, CropOperationsController],
  providers: [CropsService, CropOperationsService],
})
export class AgricultureModule {}
