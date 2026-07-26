import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { LabController } from './lab.controller';
import { LabsService } from './labs.service';
import { SamplesService } from './samples.service';

/**
 * Laboratorio (LAB-1/LAB-2): maestro de laboratorios + muestras (máquina de estados) + resultados.
 * Bounded context propio. Desbloquea el `lab_sample_id` que quedó diferido en calidad de leche (TB-2),
 * mortalidad, evaluaciones genéticas y análisis de suelo. Valida animal/potrero/lab por lectura
 * directa, sin acoplar.
 */
@Module({
  // Un resultado positivo abre el caso clínico (Fase 3.1). La dirección es Lab → Sanidad y no al
  // revés: Sanidad no sabe que existe el laboratorio, así que no hay ciclo.
  imports: [HealthModule],
  controllers: [LabController],
  providers: [LabsService, SamplesService],
})
export class LabModule {}
