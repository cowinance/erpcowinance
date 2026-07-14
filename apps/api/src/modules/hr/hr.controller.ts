import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EmployeesService } from './employees.service';

@Controller('hr/employees')
export class HrController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@Query('active') active?: string) {
    return this.employees.list(active);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.employees.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.employees.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.employees.update(id, body);
  }
  @Post(':id/terminate')
  terminate(@Param('id') id: string, @Body() body: any) {
    return this.employees.terminate(id, body ?? {});
  }
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.employees.reactivate(id);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employees.remove(id);
  }
}
