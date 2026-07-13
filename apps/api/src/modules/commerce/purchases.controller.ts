import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PurchasesService } from './purchases.service';

@Controller('commerce/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.purchases.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.purchases.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.purchases.create(body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.purchases.updateStatus(id, body?.status);
  }
}
