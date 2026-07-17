import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ClinicalCaseService } from './clinical-case.service';

@Controller()
export class ClinicalCaseController {
  constructor(private readonly cases: ClinicalCaseService) {}

  @Get('clinical-cases')
  list(
    @Query('status') status?: string,
    @Query('animal_id') animalId?: string,
    @Query('lot_id') lotId?: string,
    @Query('diagnosis_id') diagnosisId?: string,
  ) {
    return this.cases.list({ status, animalId, lotId, diagnosisId });
  }

  @Post('clinical-cases')
  create(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.cases.create(body, idempotencyKey);
  }

  @Get('clinical-cases/:id')
  get(@Param('id') id: string) {
    return this.cases.get(id);
  }

  @Post('clinical-cases/:id/follow-up')
  followUp(@Param('id') id: string, @Body() body: any) {
    return this.cases.addFollowUp(id, body);
  }

  @Post('clinical-cases/:id/close')
  close(@Param('id') id: string, @Body() body: any) {
    return this.cases.close(id, body);
  }
}
