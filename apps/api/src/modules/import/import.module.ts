import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportClaimRepository } from './import-claim.repository';
import { ImportProcessor } from './import.processor';
import { HerdModule } from '../herd/herd.module';

/**
 * ImportModule (P2) — capa de aplicación de la migración de datos. Coordina:
 * parseo (csv), mapping y persistencia de import_batches/import_rows. NO
 * reimplementa reglas de dominio del animal: para el preview (3.5) consume
 * `AnimalWriteService` de Herd (arista Import→Herd, unidireccional, sin ciclo).
 *
 * `ImportProcessor` (P-c.2) reclama y procesa batches `queued`. El endpoint de
 * commit que los produce (P-c.3) llega después — el poller ya está funcional, así
 * que no queda un `queued` sin consumidor.
 */
@Module({
  imports: [HerdModule],
  controllers: [ImportController],
  providers: [ImportService, ImportClaimRepository, ImportProcessor],
})
export class ImportModule {}
