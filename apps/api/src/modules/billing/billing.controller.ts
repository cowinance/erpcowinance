import { Body, Controller, Get, Patch } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('subscription')
  subscription() {
    return this.billing.getSubscription();
  }

  @Patch('subscription')
  changePlan(@Body() body: any) {
    return this.billing.changePlan(body);
  }
}
