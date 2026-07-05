import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('products-veterinary')
  products() {
    return this.health.products();
  }

  @Post('products-veterinary')
  createProduct(@Body() body: any) {
    return this.health.createProduct(body);
  }

  @Post('vaccinations')
  vaccinate(@Body() body: any) {
    return this.health.vaccinate(body);
  }

  @Post('treatments')
  treat(@Body() body: any) {
    return this.health.treat(body);
  }

  @Post('health-events')
  healthEvent(@Body() body: any) {
    return this.health.healthEvent(body);
  }

  @Post('mortalities')
  mortality(@Body() body: any) {
    return this.health.mortality(body);
  }

  @Get('health/withdrawals')
  withdrawals() {
    return this.health.withdrawals();
  }

  @Get('health/upcoming-vaccinations')
  upcoming(@Query('days') days?: string) {
    return this.health.upcomingVaccinations(days ? Number(days) : undefined);
  }

  @Get('health/kpis')
  kpis() {
    return this.health.kpis();
  }
}
