import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SemenService } from './semen.service';

@Controller('genetics/semen')
export class GeneticsController {
  constructor(private readonly semen: SemenService) {}

  @Get()
  list() {
    return this.semen.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.semen.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.semen.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.semen.update(id, body);
  }
  /**
   * Prueba de calidad: se descongela una pajuela y se mide la motilidad.
   *
   * Es lo único que detecta una partida arruinada por un incidente de termo — el tiempo solo no
   * arruina nada. Consume la pajuela que se descongeló.
   */
  @Post(':id/quality-checks')
  recordQuality(@Param('id') id: string, @Body() body: any) {
    return this.semen.recordQualityCheck(id, body);
  }

  /** Historial de pruebas: si la motilidad viene bajando, la partida se está yendo. */
  @Get(':id/quality-checks')
  qualityChecks(@Param('id') id: string) {
    return this.semen.qualityChecks(id);
  }

  @Post(':id/adjust')
  adjust(@Param('id') id: string, @Body() body: any) {
    return this.semen.adjustStraws(id, Number(body?.delta), body?.reason);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.semen.remove(id);
  }
}
