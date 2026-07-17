import { Module } from '@nestjs/common';
import { BreedingController } from './breeding.controller';
import { BreedingService } from './breeding.service';

/**
 * Cría y recría (C3): capa de análisis del rodeo de cría. Sin tablas propias — compone Reproducción
 * (breeding_events, pregnancies), destete (weanings), estructura (animals + animal_categories) y
 * superficie (paddocks). Bounded context de gestión, distinto de reproduction/herd/land.
 */
@Module({
  controllers: [BreedingController],
  providers: [BreedingService],
})
export class BreedingModule {}
