import { Controller, Get, Query } from '@nestjs/common';
import { BreedingService } from './breeding.service';

@Controller('breeding')
export class BreedingController {
  constructor(private readonly breeding: BreedingService) {}

  /** Índices de eficiencia del rodeo de cría en el período [from, to] (por defecto, últimos 12 meses). */
  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.breeding.summary(from, to);
  }
}
