import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WorkLogsService } from './work-logs.service';

@Controller('hr/work-logs')
export class WorkLogsController {
  constructor(private readonly workLogs: WorkLogsService) {}

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.workLogs.summary(from, to);
  }
  @Get()
  list(
    @Query('employee_id') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('task_id') taskId?: string,
    @Query('farm_id') farmId?: string,
  ) {
    return this.workLogs.list({ employee_id: employeeId, from, to, task_id: taskId, farm_id: farmId });
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.workLogs.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.workLogs.create(body);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.workLogs.update(id, body);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workLogs.remove(id);
  }
}
