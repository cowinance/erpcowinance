import { Module } from '@nestjs/common';
import { DairyController } from './dairy.controller';
import { DairyService } from './dairy.service';

/**
 * Tambo (TB-1): tanques + producción diaria por vaca. Bounded context propio. Entregas (comprador =
 * cliente) y tests de calidad llegan en TB-2.
 */
@Module({
  controllers: [DairyController],
  providers: [DairyService],
})
export class DairyModule {}
