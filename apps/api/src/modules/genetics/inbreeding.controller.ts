import { Controller, Get, Param, Query } from '@nestjs/common';
import { InbreedingService } from './inbreeding.service';

/**
 * Consanguinidad (coeficiente de Wright sobre el pedigrí real).
 *
 * Hasta acá el sistema solo sabía decir «no», y DESPUÉS de que el productor eligiera el toro. Estos
 * endpoints permiten preguntar antes —y sobre todo preguntar al revés: «¿con cuál sí?»—, que es la
 * forma en que la decisión se toma en el corral.
 */
@Controller('genetics/inbreeding')
export class InbreedingController {
  constructor(private readonly inbreeding: InbreedingService) {}

  /** F de la cría que saldría de aparear a estos dos. */
  @Get('mating')
  mating(@Query('sire_id') sireId: string, @Query('dam_id') damId: string) {
    return this.inbreeding.forMating(sireId, damId);
  }

  /** Cuán consanguíneo es un animal que ya existe. */
  @Get('animal/:id')
  animal(@Param('id') id: string) {
    return this.inbreeding.forAnimal(id);
  }

  /** Los toros de la finca ordenados por cuán poco emparentados están con esta vaca. */
  @Get('advisor/:damId')
  advisor(@Param('damId') damId: string) {
    return this.inbreeding.advisorFor(damId);
  }
}
