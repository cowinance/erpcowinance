import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FeedDeliveriesService } from './feed-deliveries.service';

@Controller('nutrition/feed-deliveries')
export class FeedDeliveriesController {
  constructor(private readonly deliveries: FeedDeliveriesService) {}

  @Get()
  list(@Query('lot_id') lotId?: string) {
    return this.deliveries.list(lotId);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.deliveries.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.deliveries.createDelivery(body);
  }
}
