import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/** Inventario (INV-1): maestro de ítems/categorías/depósitos. Bounded context propio. */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService], // Commerce (C-2) reusa recordMovementInTx en la recepción de compras.
})
export class InventoryModule {}
