import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

@Controller('finance/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@Query('direction') direction?: string) {
    return this.invoices.list(direction);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.invoices.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.invoices.createFromDocument(body);
  }
  @Post(':id/void')
  voidInvoice(@Param('id') id: string) {
    return this.invoices.voidInvoice(id);
  }
}
