import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';

/** Configuración (A3): catálogos maestros. Lectura global + extensión por tenant de razas y diagnósticos. */
@Controller('config')
export class ConfigController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get('catalogs')
  all() {
    return this.catalogs.catalogs();
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
