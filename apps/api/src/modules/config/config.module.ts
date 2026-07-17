import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { CatalogsService } from './catalogs.service';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Configuración (A3 · Configuración y catálogos maestros): el "customizing" del ERP. Primera entrega —
 * catálogos maestros: lectura de los globales (species/animal_categories/units) y extensión por tenant
 * de razas y diagnósticos. Bounded context propio.
 */
@Module({
  controllers: [ConfigController],
  providers: [CatalogsService, FeatureFlagsService],
  exports: [FeatureFlagsService], // otros módulos preguntan isEnabled(key).
})
export class ConfigModule {}
