import { Module } from '@nestjs/common';
import { WeatherModule } from '../weather/weather.module';
import { GrazingController } from './grazing.controller';
import { GrazingService } from './grazing.service';

/**
 * Pastoreo (PG-1): rotación de lotes por potrero. Bounded context propio (gestión del recurso
 * forrajero), distinto de `land` (los potreros físicos). Lee potreros/lotes por lectura directa.
 */
@Module({
  // El rendimiento del potrero cruza ocupación con el clima de sus ventanas (Fase 3.2).
  imports: [WeatherModule],
  controllers: [GrazingController],
  providers: [GrazingService],
})
export class GrazingModule {}
