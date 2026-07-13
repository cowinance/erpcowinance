import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Facturación SaaS (B-1): estado de planes/suscripción del tenant. Bounded context propio; sin
 * procesamiento de pagos (fuera de alcance).
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
