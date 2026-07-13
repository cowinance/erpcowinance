import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('commerce/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.sales.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.sales.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.sales.create(body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.sales.updateStatus(id, body?.status);
  }
}
