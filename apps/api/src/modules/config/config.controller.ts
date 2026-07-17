import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { FeatureFlagsService } from './feature-flags.service';

/** Configuración (A3): catálogos maestros, moneda, parámetros de la organización y banderas de funcionalidad. */
@Controller('config')
export class ConfigController {
  constructor(
    private readonly catalogs: CatalogsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('catalogs')
  all() {
    return this.catalogs.catalogs();
  }

  @Get('currency')
  currency() {
    return this.catalogs.currencySettings();
  }
  @Put('currency')
  setCurrency(@Body() body: any) {
    return this.catalogs.setCurrency(body);
  }

  @Get('params')
  params() {
    return this.catalogs.orgSettings();
  }
  @Put('params')
  setParams(@Body() body: any) {
    return this.catalogs.setParams(body);
  }

  @Get('feature-flags')
  featureFlags() {
    return this.flags.list();
  }
  @Put('feature-flags')
  setFeatureFlag(@Body() body: any) {
    return this.flags.set(body);
  }

  @Post('breeds')
  createBreed(@Body() body: any) {
    return this.catalogs.createBreed(body);
  }
  @Delete('breeds/:id')
  deleteBreed(@Param('id') id: string) {
    return this.catalogs.deleteBreed(id);
  }

  @Post('diagnoses')
  createDiagnosis(@Body() body: any) {
    return this.catalogs.createDiagnosis(body);
  }
  @Delete('diagnoses/:id')
  deleteDiagnosis(@Param('id') id: string) {
    return this.catalogs.deleteDiagnosis(id);
  }
}
