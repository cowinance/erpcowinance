import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { EmbryosService } from './embryos.service';

@Controller('genetics/embryos')
export class EmbryosController {
  constructor(private readonly embryos: EmbryosService) {}

  @Get()
  list() {
    return this.embryos.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.embryos.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.embryos.create(body);
  }
  @Post(':id/adjust')
  adjust(@Param('id') id: string, @Body() body: any) {
    return this.embryos.adjustStraws(id, Number(body?.delta), body?.reason);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.embryos.remove(id);
  }
}
