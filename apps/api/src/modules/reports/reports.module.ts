import { Module } from '@nestjs/common';
import { CostingModule } from '../costing/costing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MachineryModule } from '../machinery/machinery.module';
import { AgricultureModule } from '../agriculture/agriculture.module';
import { GrazingModule } from '../grazing/grazing.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Reportes. El resumen de la finca (Fase 5) importa los módulos de los verticales para COMPONER sus
 * números, no para recalcularlos. La dirección es siempre Reportes → módulo: ninguno de ellos sabe
 * que Reportes existe, así que no hay ciclo.
 */
@Module({
  imports: [CostingModule, InventoryModule, MachineryModule, AgricultureModule, GrazingModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
