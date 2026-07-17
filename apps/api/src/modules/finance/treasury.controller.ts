import { Controller, Get, Query } from '@nestjs/common';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  /** Panel de tesorería: liquidez por cuenta, flujo de caja del período [from,to], aging y días de cobro/pago. */
  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.treasury.summary(from, to);
  }
}
