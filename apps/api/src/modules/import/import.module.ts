import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportClaimRepository } from './import-claim.repository';
import { HerdModule } from '../herd/herd.module';

/**
 * ImportModule (P2) — capa de aplicación de la migración de datos. Coordina:
 * parseo (csv), mapping y persistencia de import_batches/import_rows. NO
 * reimplementa reglas de dominio del animal: para el preview (3.5) consume
 * `AnimalWriteService` de Herd (arista Import→Herd, unidireccional, sin ciclo).
 *
 * `ImportClaimRepository` (P-c.1) queda registrado pero SIN consumidor todavía:
 * el procesador (P-c.2) y el endpoint de commit (P-c.3) llegan después — no se
 * publica un `queued` sin quién lo procese.
 */
@Module({
  imports: [HerdModule],
  controllers: [ImportController],
  providers: [ImportService, ImportClaimRepository],
})
export class ImportModule {}
