import { Module } from '@nestjs/common';
import { FeedlotController } from './feedlot.controller';
import { FeedlotService } from './feedlot.service';

/**
 * Engorde y feedlot (C2): capa de análisis sobre lotes de engorde (`purpose='fattening'`). No tiene
 * tablas propias — compone Nutrición (feed_deliveries), Producción/GDP (v_weighings) y el hato
 * (current_lot_id). Bounded context de gestión, distinto de land/herd.
 */
@Module({
  controllers: [FeedlotController],
  providers: [FeedlotService],
})
export class FeedlotModule {}
