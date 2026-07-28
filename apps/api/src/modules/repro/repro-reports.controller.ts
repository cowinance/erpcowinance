import { Controller, Get, Query } from '@nestjs/common';
import { ReproReportsService } from './repro-reports.service';

@Controller()
export class ReproReportsController {
  constructor(private readonly reports: ReproReportsService) {}

  @Get('reproduction/reports/summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(from, to);
  }

  @Get('reproduction/reports/by-bull')
  byBull(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.byBull(from, to);
  }

  @Get('reproduction/reports/abortions')
  abortions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.abortions(from, to);
  }

  @Get('reproduction/reports/open')
  open() {
    return this.reports.openCows();
  }

  @Get('reproduction/reports/repeat')
  repeat() {
    return this.reports.repeatBreeders();
  }

  /** Respuesta a la sincronización: cuántas receptoras preparar para colocar un embrión. */
  @Get('reproduction/reports/synchronization')
  synchronization(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.synchronization(from, to);
  }

  @Get('reproduction/reports/diagnosis-pending')
  diagnosisPending() {
    return this.reports.diagnosisPending();
  }
}
