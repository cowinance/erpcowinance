import { Controller, Get, Query } from '@nestjs/common';
import { SireEvaluationService } from './sire-evaluation.service';

/**
 * Evaluación de toros por desempeño de la progenie (Fase 2.3).
 *
 * Es lo que convierte a Genética de depósito en herramienta: contesta «¿qué semen vuelvo a
 * comprar?» recorriendo una cadena de datos que ya existía y que nadie leía.
 */
@Controller('genetics')
export class SireEvaluationController {
  constructor(private readonly evaluation: SireEvaluationService) {}

  /** Índice por toro dentro de un grupo contemporáneo. Sin `year`, el más reciente con datos. */
  @Get('sire-evaluation')
  bySire(@Query('year') year?: string) {
    const y = year ? Number(year) : undefined;
    return this.evaluation.bySire({ year: Number.isFinite(y) ? y : undefined });
  }

  /** Costo del semen por kilo destetado: cuál RINDE más contra cuál CONVIENE, que no es lo mismo. */
  @Get('sire-cost')
  cost(@Query('year') year?: string) {
    const y = year ? Number(year) : undefined;
    return this.evaluation.costBySire({ year: Number.isFinite(y) ? y : undefined });
  }

  /** Rendimiento en el gancho por toro: el último escalón de la cadena, donde se cobra. */
  @Get('carcass-by-sire')
  carcass() {
    return this.evaluation.carcassBySire();
  }
}
