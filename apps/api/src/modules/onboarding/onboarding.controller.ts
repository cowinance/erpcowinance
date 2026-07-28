import { Controller, Delete, Get, Post } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

/**
 * Datos de ejemplo del onboarding (O-3).
 *
 * `DELETE` y no `POST /remove`: quitar el ejemplo es exactamente lo que el verbo significa, y que
 * el método diga la verdad importa más acá que en cualquier otro endpoint — es el único que borra
 * filas por decisión propia.
 */
@Controller('onboarding/sample')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status() {
    return this.onboarding.sampleStatus();
  }

  @Post()
  load() {
    return this.onboarding.loadSample();
  }

  @Delete()
  remove() {
    return this.onboarding.removeSample();
  }
}
