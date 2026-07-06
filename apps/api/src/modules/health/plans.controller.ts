import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PlansService } from './plans.service';

@Controller()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('health-plans')
  list() {
    return this.plans.list();
  }

  @Post('health-plans')
  create(@Body() body: any) {
    return this.plans.create(body);
  }

  @Post('health-plans/:id/apply')
  apply(@Param('id') id: string, @Body() body: any) {
    return this.plans.apply(id, body);
  }

  @Get('health/tasks')
  tasks(@Query('status') status?: string, @Query('days') days?: string) {
    return this.plans.tasks(status, days != null ? Number(days) : undefined);
  }

  @Post('health/tasks/:id/complete')
  complete(@Param('id') id: string) {
    return this.plans.completeTask(id);
  }
}
