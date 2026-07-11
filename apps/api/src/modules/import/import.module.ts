import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { HerdModule } from '../herd/herd.module';

/**
 * ImportModule (P2) — capa de aplicación de la migración de datos. Coordina:
 * parseo (csv), mapping y persistencia de import_batches/import_rows. NO
 * reimplementa reglas de dominio del animal: para el preview (3.5) consume
 * `AnimalWriteService` de Herd (arista Import→Herd, unidireccional, sin ciclo).
 */
@Module({ imports: [HerdModule], controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
