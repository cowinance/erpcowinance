import { Controller, Get, Query } from '@nestjs/common';
import { HealthReportsService } from './health-reports.service';

@Controller()
export class HealthReportsController {
  constructor(private readonly reports: HealthReportsService) {}

  @Get('health/reports/incidence')
  incidence(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.incidence(from, to);
  }

  @Get('health/reports/mortality')
  mortality(@Query('from') from?: string, @Query('to') to?: string, @Query('by') by?: string) {
    return this.reports.mortality(from, to, by === 'lot' ? 'lot' : by === 'period' ? 'period' : 'cause');
  }

  @Get('health/reports/recurrent')
  recurrent(@Query('from') from?: string, @Query('to') to?: string, @Query('min') min?: string) {
    return this.reports.recurrent(from, to, min ? Number(min) : undefined);
  }

  @Get('health/reports/products')
  products(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.products(from, to);
  }

  @Get('health/reports/effectiveness')
  effectiveness(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.effectiveness(from, to);
  }

  @Get('health/reports/mortality-anomaly')
  mortalityAnomaly(@Query('days') days?: string, @Query('threshold') threshold?: string) {
    return this.reports.mortalityAnomaly(days ? Number(days) : undefined, threshold ? Number(threshold) : undefined);
  }
}
