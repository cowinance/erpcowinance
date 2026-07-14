import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { FeedDeliveriesController } from './feed-deliveries.controller';
import { RationsService } from './rations.service';
import { FeedDeliveriesService } from './feed-deliveries.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Nutrición: raciones (N-1) + entregas a lote (N-2). Depende (unidireccional) de Inventory para
 * descontar stock por `consumption` al entregar una ración, reusando su regla única de stock.
 */
@Module({
  imports: [InventoryModule],
  controllers: [NutritionController, FeedDeliveriesController],
  providers: [RationsService, FeedDeliveriesService],
})
export class NutritionModule {}
