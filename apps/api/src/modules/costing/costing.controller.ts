import { Controller, Get, Query } from '@nestjs/common';
import { CostingService, type CostLevel, type ProfitLevel } from './costing.service';

/** Costos y rentabilidad (G2). E1: acumulación de costos reales por centro. */
@Controller('costs')
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  /** Costos por centro (lote/animal/cultivo/máquina) en un período, con desglose por categoría. */
  @Get('by-center')
  byCenter(@Query('level') level?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.costing.costsByCenter({ level: level as CostLevel | undefined, from, to });
  }

  /** Costo unitario por actividad: $/kg producido, $/litro y $/kg cosechado + $/ha (E2). */
  @Get('unit')
  unit(@Query('from') from?: string, @Query('to') to?: string) {
    return this.costing.unitCosts({ from, to });
  }

  /** Rentabilidad: ingresos − costos → margen por lote, animal o actividad (E3). */
  @Get('profitability')
  profitability(@Query('level') level?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.costing.profitability({ level: level as ProfitLevel | undefined, from, to });
  }
}
