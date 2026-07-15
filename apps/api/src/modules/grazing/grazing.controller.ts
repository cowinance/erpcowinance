import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GrazingService } from './grazing.service';

@Controller('grazing')
export class GrazingController {
  constructor(private readonly grazing: GrazingService) {}

  @Get()
  list(@Query('paddock_id') paddockId?: string, @Query('lot_id') lotId?: string) {
    return this.grazing.list(paddockId, lotId);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.grazing.get(id);
  }
  @Post()
  enter(@Body() body: any) {
    return this.grazing.enter(body);
  }
  @Patch(':id/exit')
  exit(@Param('id') id: string, @Body() body: any) {
    return this.grazing.exit(id, body);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.grazing.remove(id);
  }
}
