import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Controller('finance')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('trial-balance')
  trialBalance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.ledger.trialBalance(from, to);
  }
  @Get('journal')
  listJournal(@Query('status') status?: string) {
    return this.ledger.list(status);
  }
  @Get('journal/:id')
  getEntry(@Param('id') id: string) {
    return this.ledger.get(id);
  }
  @Post('journal')
  createEntry(@Body() body: any) {
    return this.ledger.createEntry(body);
  }
  @Post('journal/:id/reverse')
  reverseEntry(@Param('id') id: string, @Body() body: any) {
    return this.ledger.reverseEntry(id, body ?? {});
  }
}
