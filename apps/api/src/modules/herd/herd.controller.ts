import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { LotsService } from './lots.service';
import { HerdService } from './herd.service';
import { AnimalStatusService } from './animal-status.service';
import { AnimalIdentifiersService } from './animal-identifiers.service';
import { AnimalQualityService } from './animal-quality.service';

@Controller()
export class HerdController {
  constructor(
    private readonly herd: HerdService,
    private readonly lotsService: LotsService,
    private readonly status: AnimalStatusService,
    private readonly identifiers: AnimalIdentifiersService,
    private readonly qualityService: AnimalQualityService,
  ) {}

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

  // Ruta estática ANTES de la paramétrica `animals/:id` (si no, `quality` cae en :id).
  @Get('animals/quality')
  quality(@Query('no_weighing_days') days?: string) {
    return this.qualityService.qualityReport({ noWeighingDays: days ? Number(days) : undefined });
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

  @Get('animals/:id/genealogy')
  genealogy(@Param('id') id: string, @Query('depth') depth?: string) {
    return this.qualityService.animalGenealogy(id, depth ? Number(depth) : undefined);
  }

  @Post('animals/:id/events')
  registerEvent(@Param('id') id: string, @Body() body: any) {
    return this.herd.registerEvent(id, body);
  }

  @Delete('weighings/:id')
  deleteWeighing(@Param('id') id: string) {
    return this.herd.deleteWeighing(id);
  }

  @Post('animals/:id/identifiers')
  addIdentifier(@Param('id') id: string, @Body() body: any) {
    return this.identifiers.addIdentifier(id, body);
  }

  @Post('animals/:id/identifiers/:idfId/retire')
  retireIdentifier(@Param('id') id: string, @Param('idfId') idfId: string) {
    return this.identifiers.retireIdentifier(id, idfId);
  }

  @Post('animals/:id/identifiers/:idfId/make-official')
  makeOfficial(@Param('id') id: string, @Param('idfId') idfId: string) {
    return this.identifiers.makeOfficialIdentifier(id, idfId);
  }

  @Put('animals/:id/breeds')
  setBreeds(@Param('id') id: string, @Body() body: any) {
    return this.herd.setBreeds(id, body?.breeds ?? []);
  }

  @Post('animals/:id/status')
  changeStatus(@Param('id') id: string, @Body() body: any) {
    return this.status.changeStatus(id, { toStatus: body?.status, reason: body?.reason, occurredAt: body?.occurred_at });
  }

  @Post('animals/status/bulk')
  bulkStatus(@Body() body: any) {
    return this.status.bulkChangeStatus(body?.animal_ids ?? [], { toStatus: body?.status, reason: body?.reason });
  }

  @Post('animals/category/bulk')
  bulkCategory(@Body() body: any) {
    return this.herd.bulkChangeCategory(body?.animal_ids ?? [], body?.category_code);
  }

  @Post('lots')
  createLot(@Body() body: any) {
    return this.lotsService.createLot(body);
  }

  @Get('lots')
  lots(@Query('include_archived') includeArchived?: string) {
    return this.lotsService.lots(includeArchived === 'true');
  }

  @Get('lots/:id')
  getLot(@Param('id') id: string) {
    return this.lotsService.getLot(id);
  }

  @Get('lots/:id/history')
  lotHistory(@Param('id') id: string) {
    return this.lotsService.lotHistory(id);
  }

  @Get('lots/:id/metrics')
  lotMetrics(@Param('id') id: string, @Query('target') target?: string) {
    return this.lotsService.lotMetrics(id, target ? Number(target) : undefined);
  }

  @Put('lots/:id')
  updateLot(@Param('id') id: string, @Body() body: any) {
    return this.lotsService.updateLot(id, body);
  }

  @Delete('lots/:id')
  deleteLot(@Param('id') id: string) {
    return this.lotsService.deleteLot(id);
  }

  @Get('catalogs/categories')
  categories() {
    return this.herd.categories();
  }
}
