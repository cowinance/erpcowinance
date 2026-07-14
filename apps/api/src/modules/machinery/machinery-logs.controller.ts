import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MachineryLogsService } from './machinery-logs.service';

@Controller('machinery/:id')
export class MachineryLogsController {
  constructor(private readonly logs: MachineryLogsService) {}

  @Get('maintenance')
  listMaintenance(@Param('id') id: string) {
    return this.logs.listMaintenance(id);
  }
  @Post('maintenance')
  recordMaintenance(@Param('id') id: string, @Body() body: any) {
    return this.logs.recordMaintenance(id, body);
  }
  @Get('fuel')
  listFuel(@Param('id') id: string) {
    return this.logs.listFuel(id);
  }
  @Post('fuel')
  recordFuel(@Param('id') id: string, @Body() body: any) {
    return this.logs.recordFuel(id, body);
  }
}
