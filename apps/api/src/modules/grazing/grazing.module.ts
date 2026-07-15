import { Module } from '@nestjs/common';
import { GrazingController } from './grazing.controller';
import { GrazingService } from './grazing.service';

/**
 * Pastoreo (PG-1): rotación de lotes por potrero. Bounded context propio (gestión del recurso
 * forrajero), distinto de `land` (los potreros físicos). Lee potreros/lotes por lectura directa.
 */
@Module({
  controllers: [GrazingController],
  providers: [GrazingService],
})
export class GrazingModule {}
