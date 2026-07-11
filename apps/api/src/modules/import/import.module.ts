import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

/**
 * ImportModule (P2) — capa de aplicación de la migración de datos. Coordina:
 * parseo (csv), mapping sugerido (descriptor de Herd, const pura) y persistencia
 * de import_batches/import_rows. NO reimplementa reglas de dominio del animal.
 * En 3.3b expone solo POST /v1/imports; los GET llegan en 3.3c.
 */
@Module({ controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
