import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('herd-inventory')
  herdInventory(@Query('at') at?: string, @Query('group_by') groupBy?: 'category' | 'lot' | 'sex') {
    return this.reports.herdInventory(at, groupBy);
  }

  @Get('herd-movements')
  herdMovements(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.herdMovements(from, to);
  }

  @Get('production')
  production(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.production(from, to);
  }

  @Get('production-weight-series')
  productionWeightSeries(@Query('from') from?: string, @Query('to') to?: string, @Query('lot_id') lotId?: string) {
    return this.reports.productionWeightSeries(from, to, lotId);
  }

  @Get('condition-distribution')
  conditionDistribution(@Query('at') at?: string, @Query('lot_id') lotId?: string) {
    return this.reports.conditionDistribution(at, lotId);
  }

  @Get('reproduction')
  reproduction(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.reproduction(from, to);
  }
}
