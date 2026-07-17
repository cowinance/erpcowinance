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
    @Query('paddock') paddock?: string,
    @Query('breed') breed?: string,
    @Query('origin') origin?: string,
    @Query('q') q?: string,
    @Query('sex') sex?: string,
    @Query('min_weight') minWeight?: string,
    @Query('max_weight') maxWeight?: string,
    @Query('min_age') minAge?: string,
    @Query('max_age') maxAge?: string,
    @Query('with_lot') withLot?: string,
    @Query('with_photo') withPhoto?: string,
    @Query('with_official_id') withOfficialId?: string,
    @Query('withdrawal') withdrawal?: string,
    @Query('open_case') openCase?: string,
    @Query('pregnant') pregnant?: string,
    @Query('no_recent_weighing') noRecentWeighing?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const num = (v?: string) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    const bool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);
    return this.herd.listAnimals({
      status, category, lot, paddock, breed, origin, q, sex,
      minWeight: num(minWeight), maxWeight: num(maxWeight), minAgeMonths: num(minAge), maxAgeMonths: num(maxAge),
      withLot: bool(withLot), withPhoto: bool(withPhoto), withOfficialId: bool(withOfficialId),
      withdrawal: withdrawal === 'true', openCase: openCase === 'true', pregnant: pregnant === 'true',
      noRecentWeighingDays: num(noRecentWeighing),
      sort, dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
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

  @Put('animals/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.herd.updateAnimal(id, body);
  }

  @Get('animals/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.herd.timeline(id);
  }

  @Get('animals/:id/overview')
  overview(@Param('id') id: string) {
    return this.herd.animalOverview(id);
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
  lots(@Query('include_archived') includeArchived?: string) {
    return this.herd.lots(includeArchived === 'true');
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
