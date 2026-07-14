import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { RationsService } from './rations.service';

/**
 * Nutrición (N-1): raciones (fórmula + ingredientes de inventario). Bounded context propio. Las
 * entregas a lote que descuentan stock (N-2) reusarán InventoryService.recordMovementInTx.
 */
@Module({
  controllers: [NutritionController],
  providers: [RationsService],
})
export class NutritionModule {}
