import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CropOperationsService } from './crop-operations.service';

@Controller('agriculture/crops/:id')
export class CropOperationsController {
  constructor(private readonly ops: CropOperationsService) {}

  @Get('operations')
  listOperations(@Param('id') id: string) {
    return this.ops.listOperations(id);
  }
  @Post('operations')
  recordOperation(@Param('id') id: string, @Body() body: any) {
    return this.ops.recordOperation(id, body);
  }
  @Get('harvests')
  listHarvests(@Param('id') id: string) {
    return this.ops.listHarvests(id);
  }
  @Post('harvests')
  recordHarvest(@Param('id') id: string, @Body() body: any) {
    return this.ops.recordHarvest(id, body);
  }
}
