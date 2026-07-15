import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DairyService } from './dairy.service';

@Controller('dairy')
export class DairyController {
  constructor(private readonly dairy: DairyService) {}

  @Get('tanks')
  listTanks() {
    return this.dairy.listTanks();
  }
  @Post('tanks')
  createTank(@Body() body: any) {
    return this.dairy.createTank(body);
  }
  @Delete('tanks/:id')
  deleteTank(@Param('id') id: string) {
    return this.dairy.deleteTank(id);
  }

  @Get('production')
  listProduction(@Query('production_date') productionDate?: string, @Query('animal_id') animalId?: string) {
    return this.dairy.listProduction(productionDate, animalId);
  }
  @Post('production')
  recordProduction(@Body() body: any) {
    return this.dairy.recordProduction(body);
  }
  @Get('production/by-day')
  productionByDay() {
    return this.dairy.productionByDay();
  }

  @Get('deliveries')
  listDeliveries() {
    return this.dairy.listDeliveries();
  }
  @Post('deliveries')
  recordDelivery(@Body() body: any) {
    return this.dairy.recordDelivery(body);
  }

  @Get('quality-tests')
  listQualityTests() {
    return this.dairy.listQualityTests();
  }
  @Post('quality-tests')
  recordQualityTest(@Body() body: any) {
    return this.dairy.recordQualityTest(body);
  }
}
