import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LabsService } from './labs.service';
import { SamplesService } from './samples.service';

/**
 * Laboratorio: maestro (`lab/labs`), muestras (`lab/samples`) y resultados
 * (`lab/samples/:id/results`). Un solo prefijo `lab` para todo el bounded context.
 */
@Controller('lab')
export class LabController {
  constructor(
    private readonly labs: LabsService,
    private readonly samples: SamplesService,
  ) {}

  // ── Laboratorios (maestro) ──
  @Get('labs')
  listLabs() {
    return this.labs.list();
  }
  @Get('labs/:id')
  getLab(@Param('id') id: string) {
    return this.labs.get(id);
  }
  @Post('labs')
  createLab(@Body() body: any) {
    return this.labs.create(body);
  }
  @Patch('labs/:id')
  updateLab(@Param('id') id: string, @Body() body: any) {
    return this.labs.update(id, body);
  }
  @Delete('labs/:id')
  removeLab(@Param('id') id: string) {
    return this.labs.remove(id);
  }

  // ── Muestras ──
  @Get('samples')
  listSamples(
    @Query('status') status?: string,
    @Query('animal_id') animalId?: string,
    @Query('paddock_id') paddockId?: string,
    @Query('lab_id') labId?: string,
  ) {
    return this.samples.list({ status, animal_id: animalId, paddock_id: paddockId, lab_id: labId });
  }
  @Get('samples/:id')
  getSample(@Param('id') id: string) {
    return this.samples.get(id);
  }
  @Post('samples')
  createSample(@Body() body: any) {
    return this.samples.create(body);
  }
  @Patch('samples/:id/status')
  setStatus(@Param('id') id: string, @Body() body: any) {
    return this.samples.setStatus(id, body?.status);
  }
  @Delete('samples/:id')
  removeSample(@Param('id') id: string) {
    return this.samples.remove(id);
  }

  // ── Resultados ──
  @Get('samples/:id/results')
  listResults(@Param('id') id: string) {
    return this.samples.listResults(id);
  }
  @Post('samples/:id/results')
  addResult(@Param('id') id: string, @Body() body: any) {
    return this.samples.addResult(id, body);
  }

  /**
   * Abre el caso clínico desde un resultado que el sistema no abrió solo (Fase 3.1).
   *
   * Es el clic que convierte la alerta «fuera de rango» en acción: los resultados sin diagnóstico
   * necesitan criterio veterinario, y esto lo aplica sin retipear el animal ni el diagnóstico.
   */
  @Post('results/:id/clinical-case')
  openCase(@Param('id') id: string, @Body() body: any) {
    return this.samples.openCaseFromResult(id, body);
  }
}
