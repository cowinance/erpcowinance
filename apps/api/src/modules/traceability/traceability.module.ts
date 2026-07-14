import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller';
import { GuidesService } from './guides.service';

/**
 * Trazabilidad (T-1): guías de traslado de hacienda. Bounded context propio. Las certificaciones (T-2)
 * cuelgan del mismo módulo.
 */
@Module({
  controllers: [TraceabilityController],
  providers: [GuidesService],
})
export class TraceabilityModule {}
