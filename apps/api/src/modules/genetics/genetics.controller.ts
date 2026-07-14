import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SemenService } from './semen.service';

@Controller('genetics/semen')
export class GeneticsController {
  constructor(private readonly semen: SemenService) {}

  @Get()
  list() {
    return this.semen.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.semen.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.semen.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.semen.update(id, body);
  }
  @Post(':id/adjust')
  adjust(@Param('id') id: string, @Body() body: any) {
    return this.semen.adjustStraws(id, Number(body?.delta), body?.reason);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.semen.remove(id);
  }
}
