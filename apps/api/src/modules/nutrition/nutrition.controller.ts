import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { RationsService } from './rations.service';

@Controller('nutrition/rations')
export class NutritionController {
  constructor(private readonly rations: RationsService) {}

  @Get()
  list() {
    return this.rations.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.rations.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.rations.createRation(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.rations.updateRation(id, body);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rations.deleteRation(id);
  }
  @Put(':id/ingredients')
  setIngredients(@Param('id') id: string, @Body() body: any) {
    return this.rations.setIngredients(id, body);
  }
}
