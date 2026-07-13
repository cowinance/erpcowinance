import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';

@Controller('finance')
export class FinanceController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  listAccounts() {
    return this.accounts.listAccounts();
  }
  @Post('accounts')
  createAccount(@Body() body: any) {
    return this.accounts.createAccount(body);
  }
  @Patch('accounts/:id')
  updateAccount(@Param('id') id: string, @Body() body: any) {
    return this.accounts.updateAccount(id, body);
  }
  @Delete('accounts/:id')
  deleteAccount(@Param('id') id: string) {
    return this.accounts.deleteAccount(id);
  }

  @Get('periods')
  listPeriods() {
    return this.accounts.listPeriods();
  }
  @Post('periods')
  createPeriod(@Body() body: any) {
    return this.accounts.createPeriod(body);
  }
  @Patch('periods/:id/status')
  setPeriodStatus(@Param('id') id: string, @Body() body: any) {
    return this.accounts.setPeriodStatus(id, body?.status);
  }

  @Get('cost-centers')
  listCostCenters() {
    return this.accounts.listCostCenters();
  }
  @Post('cost-centers')
  createCostCenter(@Body() body: any) {
    return this.accounts.createCostCenter(body);
  }
  @Delete('cost-centers/:id')
  deleteCostCenter(@Param('id') id: string) {
    return this.accounts.deleteCostCenter(id);
  }
}
