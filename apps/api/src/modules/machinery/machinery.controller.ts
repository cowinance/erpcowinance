import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MachineryService } from './machinery.service';

@Controller('machinery')
export class MachineryController {
  constructor(private readonly machinery: MachineryService) {}

  /**
   * Lo que cuesta usar cada máquina: costo por hora (o por km) y cuánto del mantenimiento fue por
   * rotura (Fase 4). Antes de `:id` porque una ruta estática después de la paramétrica no se alcanza.
   */
  @Get('costs')
  costs(@Query('from') from?: string, @Query('to') to?: string) {
    return this.machinery.costs({ from, to });
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.machinery.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.machinery.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.machinery.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.machinery.update(id, body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.machinery.updateStatus(id, body?.status);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.machinery.remove(id);
  }
}
