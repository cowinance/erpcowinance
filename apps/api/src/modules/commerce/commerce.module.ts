import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Comercial: maestro de socios (C-1) + compras (C-2). Depende de Inventory (unidireccional) para
 * enganchar la recepción de compras al kardex reusando su regla única de stock.
 */
@Module({
  imports: [InventoryModule],
  controllers: [CommerceController, PurchasesController],
  providers: [CommerceService, PurchasesService],
})
export class CommerceModule {}
