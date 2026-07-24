import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';

/**
 * G2 · Costos y rentabilidad — contabilidad de gestión. Capa de ANÁLISIS: compone los costos que
 * los módulos operativos ya registraron (sanidad/nutrición/agricultura/maquinaria). Sin tablas
 * propias y sin dependencias de otros módulos: lee sus tablas de hecho directamente, como hacen
 * Feedlot/Cría/Tesorería, para no acoplar el grafo de módulos.
 */
@Module({ controllers: [CostingController], providers: [CostingService], exports: [CostingService] })
export class CostingModule {}
