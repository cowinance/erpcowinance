import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.herd.listAnimals({ status, category, lot, q, limit: limit ? Number(limit) : undefined, cursor });
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

  @Get('lots')
  lots() {
    return this.herd.lots();
  }

  @Get('catalogs/categories')
  categories() {
    return this.herd.categories();
  }
}
