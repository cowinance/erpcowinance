import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { StrawStatus } from '@cowinance/domain';
import { StrawsService } from './straws.service';

/**
 * Pajuelas (GT-2). El origen viaja por query y no por la ruta porque las dos preguntas que se hacen
 * —«¿qué pajuelas tiene esta partida?» y «¿qué hay en este gobelete?»— son la misma consulta mirada
 * desde puntas distintas, y partirla en dos árboles de rutas duplicaría el mismo listado.
 */
@Controller('genetics/straws')
export class StrawsController {
  constructor(private readonly straws: StrawsService) {}

  @Get()
  list(@Query('semen_batch_id') semen?: string, @Query('embryo_id') embryo?: string) {
    return this.straws.listFor({ semen_batch_id: semen ?? null, embryo_id: embryo ?? null });
  }

  @Get('by-goblet/:id')
  byGoblet(@Param('id') id: string) {
    return this.straws.listByGoblet(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.straws.createBatch({ semen_batch_id: body?.semen_batch_id ?? null, embryo_id: body?.embryo_id ?? null }, body);
  }

  /** Mover un conjunto a un gobelete; `goblet_id: null` las deja sin ubicar. */
  @Post('move')
  move(@Body() body: any) {
    return this.straws.move(body?.ids ?? [], body?.goblet_id ?? null);
  }

  @Patch(':id/code')
  setCode(@Param('id') id: string, @Body() body: any) {
    return this.straws.setCode(id, body?.code);
  }

  @Patch(':id/status')
  transition(@Param('id') id: string, @Body() body: any) {
    return this.straws.transition(id, body?.status as StrawStatus, body?.reason);
  }
}
