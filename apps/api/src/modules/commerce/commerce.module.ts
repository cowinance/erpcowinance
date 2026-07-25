import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HerdModule } from '../herd/herd.module';

/**
 * Comercial: maestro de socios (C-1) + compras (C-2) + ventas (C-3) + CRM (F3). Depende (unidireccional) de
 * Inventory (kardex, regla única de stock) y de Herd (AnimalStatusService, transición sincronizada
 * a `sold`) para enganchar recepción de compras y entrega de ventas.
 *
 * El CRM vive acá y no en un módulo aparte porque comparte `business_partners` con compras y
 * ventas: separarlo obligaría a que dos módulos escriban sobre la misma tabla maestra.
 */
@Module({
  imports: [InventoryModule, HerdModule],
  controllers: [CommerceController, PurchasesController, SalesController, CrmController],
  providers: [CommerceService, PurchasesService, SalesService, CrmService],
  exports: [PurchasesService, SalesService, CrmService], // Finance (F-2) los lee para postear asientos automáticos.
})
export class CommerceModule {}
