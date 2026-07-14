import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AccountsService } from './accounts.service';

@Controller('finance')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly accounts: AccountsService,
  ) {}

  @Get('payments')
  list(@Query('direction') direction?: string) {
    return this.payments.list(direction);
  }
  @Get('payments/:id')
  get(@Param('id') id: string) {
    return this.payments.get(id);
  }
  @Post('payments')
  create(@Body() body: any) {
    return this.payments.createPayment(body);
  }

  @Get('bank-accounts')
  listBankAccounts() {
    return this.accounts.listBankAccounts();
  }
  @Post('bank-accounts')
  createBankAccount(@Body() body: any) {
    return this.accounts.createBankAccount(body);
  }
  @Delete('bank-accounts/:id')
  deleteBankAccount(@Param('id') id: string) {
    return this.accounts.deleteBankAccount(id);
  }
}
