import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { NitrogenService } from './nitrogen.service';

/** Nitrógeno del termo (GT-4). */
@Controller('genetics/cryo')
export class NitrogenController {
  constructor(private readonly nitrogen: NitrogenService) {}

  /** Estado de todos los termos. Ruta estática antes de la paramétrica, o nunca se alcanza. */
  @Get('nitrogen')
  all() {
    return this.nitrogen.statusAll();
  }

  @Get('tanks/:id/nitrogen')
  status(@Param('id') id: string) {
    return this.nitrogen.status(id);
  }

  @Post('tanks/:id/nitrogen/readings')
  addReading(@Param('id') id: string, @Body() body: any) {
    return this.nitrogen.addReading(id, body);
  }

  @Post('tanks/:id/nitrogen/refills')
  addRefill(@Param('id') id: string, @Body() body: any) {
    return this.nitrogen.addRefill(id, body);
  }

  @Put('tanks/:id/nitrogen/lead-days')
  setLeadDays(@Param('id') id: string, @Body() body: any) {
    return this.nitrogen.setLeadDays(id, body?.refill_lead_days);
  }
}
