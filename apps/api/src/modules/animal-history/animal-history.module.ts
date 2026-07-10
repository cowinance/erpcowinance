import { Module } from '@nestjs/common';
import { AnimalEventSyncHandler } from './sync/animal-event-sync.handler';

/**
 * Bounded context permanente para la línea de tiempo del animal (ADR-0009).
 * Subdominio genérico, no propiedad de herd/health/repro — usado
 * transversalmente por cualquier módulo que registre un hecho sobre un
 * animal. `application/`, `domain/`, `infrastructure/` quedan vacías hasta
 * que un caso real las necesite (ver ADR-0009, excepción documentada a la
 * Regla Permanente 4).
 */
@Module({
  providers: [AnimalEventSyncHandler],
})
export class AnimalHistoryModule {}
