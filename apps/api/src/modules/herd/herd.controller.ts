import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { HerdService } from './herd.service';

@Controller()
export class HerdController {
  constructor(private readonly herd: HerdService) {}

  @Get('animals')
  list(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('lot') lot?: string,
    @Query('q') q?: string,
    @Query('sex') sex?: string,
    @Query('min_weight') minWeight?: string,
    @Query('max_weight') maxWeight?: string,
    @Query('min_age') minAge?: string,
    @Query('max_age') maxAge?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const num = (v?: string) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    return this.herd.listAnimals({
      status, category, lot, q, sex,
      minWeight: num(minWeight), maxWeight: num(maxWeight), minAgeMonths: num(minAge), maxAgeMonths: num(maxAge),
      limit: limit ? Number(limit) : undefined, cursor,
    });
  }

  @Post('animals')
  create(@Body() body: any) {
    return this.herd.createAnimal(body);
  }

  @Post('animals/lookup')
  lookup(@Body() body: any) {
    return this.herd.lookup(body);
  }

  @Get('animals/:id')
  get(@Param('id') id: string) {
    return this.herd.getAnimal(id);
  }

  @Get('animals/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.herd.timeline(id);
  }

  @Post('animals/:id/events')
  registerEvent(@Param('id') id: string, @Body() body: any) {
    return this.herd.registerEvent(id, body);
  }

  @Post('lots')
  createLot(@Body() body: any) {
    return this.herd.createLot(body);
  }

  @Get('lots')
  lots() {
    return this.herd.lots();
  }

  @Get('lots/:id')
  getLot(@Param('id') id: string) {
    return this.herd.getLot(id);
  }

  @Get('lots/:id/history')
  lotHistory(@Param('id') id: string) {
    return this.herd.lotHistory(id);
  }

  @Get('lots/:id/metrics')
  lotMetrics(@Param('id') id: string, @Query('target') target?: string) {
    return this.herd.lotMetrics(id, target ? Number(target) : undefined);
  }

  @Put('lots/:id')
  updateLot(@Param('id') id: string, @Body() body: any) {
    return this.herd.updateLot(id, body);
  }

  @Delete('lots/:id')
  deleteLot(@Param('id') id: string) {
    return this.herd.deleteLot(id);
  }

  @Get('catalogs/categories')
  categories() {
    return this.herd.categories();
  }
}
