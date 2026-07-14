import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';

@Controller('hr/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.payroll.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.payroll.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.payroll.create(body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.payroll.updateStatus(id, body?.status);
  }
}
