import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CarcassService } from './carcass.service';

@Controller('slaughter/carcasses')
export class SlaughterController {
  constructor(private readonly carcasses: CarcassService) {}

  @Get()
  list(@Query('sale_id') saleId?: string) {
    return this.carcasses.list(saleId);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.carcasses.get(id);
  }
  @Post()
  record(@Body() body: any) {
    return this.carcasses.record(body);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.carcasses.remove(id);
  }
}
