import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller';
import { CertificationsController } from './certifications.controller';
import { GuidesService } from './guides.service';
import { CertificationsService } from './certifications.service';

/**
 * Trazabilidad: guías de traslado (T-1) + certificaciones (T-2). Bounded context propio.
 */
@Module({
  controllers: [TraceabilityController, CertificationsController],
  providers: [GuidesService, CertificationsService],
})
export class TraceabilityModule {}
