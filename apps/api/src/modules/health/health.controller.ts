import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
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
  vaccinate(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.health.vaccinate(body, idempotencyKey);
  }

  @Post('treatments')
  treat(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.health.treat(body, idempotencyKey);
  }

  @Post('vaccinations/bulk')
  vaccinateMass(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.health.vaccinateMass(body, idempotencyKey);
  }

  @Post('treatments/bulk')
  treatMass(@Body() body: any, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.health.treatMass(body, idempotencyKey);
  }

  @Get('health/coverage')
  coverage(@Query('by') by?: string, @Query('product_id') productId?: string) {
    return this.health.coverage(by === 'category' ? 'category' : 'lot', productId);
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

  @Get('health/critical-animals')
  criticalAnimals(@Query('limit') limit?: string) {
    return this.health.criticalAnimals(limit ? Number(limit) : undefined);
  }

  @Get('health/by-lot')
  byLot() {
    return this.health.lotHealth();
  }
}
