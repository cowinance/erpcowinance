import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HerdModule } from '../herd/herd.module';

/**
 * Comercial: maestro de socios (C-1) + compras (C-2) + ventas (C-3). Depende (unidireccional) de
 * Inventory (kardex, regla única de stock) y de Herd (AnimalStatusService, transición sincronizada
 * a `sold`) para enganchar recepción de compras y entrega de ventas.
 */
@Module({
  imports: [InventoryModule, HerdModule],
  controllers: [CommerceController, PurchasesController, SalesController],
  providers: [CommerceService, PurchasesService, SalesService],
})
export class CommerceModule {}
