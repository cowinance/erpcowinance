import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LandService } from './land.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class LandController {
  constructor(private readonly land: LandService) {}

  @Get('paddocks')
  paddocks() {
    return this.land.paddocks();
  }

  @Post('paddocks')
  createPaddock(@Body() body: any) {
    return this.land.createPaddock(body);
  }

  @Post('paddocks/:id/move-lot')
  moveLot(@Param('id') id: string, @Body() body: any) {
    return this.land.moveLot(id, body);
  }

  /**
   * Movimiento individual/grupal (P3 M-1.d). El `Idempotency-Key` (uuid) del cliente,
   * si viene y es válido, se usa como `movementId` (deduplica un doble-submit
   * concurrente vía el índice único); si no, se genera uno fresco (el diff-aware de
   * la regla cubre el reintento secuencial idéntico).
   */
  @Post('movements')
  moveAnimals(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    const movementId = idempotencyKey && UUID_RE.test(idempotencyKey) ? idempotencyKey : randomUUID();
    return this.land.moveAnimals(body, movementId);
  }
}
