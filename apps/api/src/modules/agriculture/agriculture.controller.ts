import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CropsService } from './crops.service';

@Controller('agriculture/crops')
export class AgricultureController {
  constructor(private readonly crops: CropsService) {}

  /** Rinde y costo por hectárea, comparados contra los lotes del mismo cultivo (Fase 4). */
  @Get('yields')
  yields(@Query('from') from?: string, @Query('to') to?: string) {
    return this.crops.yields({ from, to });
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.crops.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.crops.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.crops.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.crops.update(id, body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.crops.updateStatus(id, body?.status);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.crops.remove(id);
  }
}
