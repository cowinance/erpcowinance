import { Module } from '@nestjs/common';
import { SlaughterController } from './slaughter.controller';
import { CarcassService } from './carcass.service';

/**
 * Faena (FA-1): registro de res por animal, con el rendimiento derivado del último peso vivo. Bounded
 * context propio. Lee pesadas (Herd) y valida venta/frigorífico (Comercial) por lectura directa, sin
 * acoplar módulos. El análisis (rendimiento por lote/padre) y la web llegan en FA-2.
 */
@Module({
  controllers: [SlaughterController],
  providers: [CarcassService],
})
export class SlaughterModule {}
