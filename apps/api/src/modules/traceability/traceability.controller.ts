import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GuidesService } from './guides.service';

@Controller('traceability/guides')
export class TraceabilityController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.guides.list(status);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.guides.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.guides.create(body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.guides.updateStatus(id, body?.status);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.guides.remove(id);
  }
}
