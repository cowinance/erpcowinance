import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { HospitalizationService } from './hospitalization.service';

@Controller()
export class HospitalizationController {
  constructor(private readonly hosp: HospitalizationService) {}

  @Get('health/admissions')
  list(@Query('status') status?: string) {
    return this.hosp.list(status);
  }

  @Post('health/admissions')
  admit(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.hosp.admit(body, idempotencyKey);
  }

  @Post('health/admissions/:id/discharge')
  discharge(@Param('id') id: string, @Body() body: any) {
    return this.hosp.discharge(id, body);
  }
}
