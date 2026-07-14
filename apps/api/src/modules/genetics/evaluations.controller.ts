import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';

@Controller('genetics/evaluations')
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get()
  list(@Query('animal_id') animalId?: string) {
    return this.evaluations.list(animalId);
  }
  @Post()
  create(@Body() body: any) {
    return this.evaluations.create(body);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.evaluations.remove(id);
  }
}
