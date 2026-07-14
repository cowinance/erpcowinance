import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { BudgetsService } from './budgets.service';

@Controller('finance/budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.budgets.list(status);
  }
  @Get(':id/vs-actual')
  vsActual(@Param('id') id: string, @Query('by') by?: string, @Query('cost_center_id') costCenterId?: string) {
    return this.budgets.vsActual(id, by === 'month', costCenterId);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.budgets.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.budgets.create(body);
  }
  @Put(':id/lines')
  setLines(@Param('id') id: string, @Body() body: any) {
    return this.budgets.setLines(id, body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.budgets.updateStatus(id, body?.status);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.budgets.remove(id);
  }
}
