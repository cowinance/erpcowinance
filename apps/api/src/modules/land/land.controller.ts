import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LandService } from './land.service';

@Controller()
export class LandController {
  constructor(private readonly land: LandService) {}

  @Get('paddocks')
  paddocks() {
    return this.land.paddocks();
  }

  @Post('paddocks/:id/move-lot')
  moveLot(@Param('id') id: string, @Body() body: any) {
    return this.land.moveLot(id, body);
  }
}
