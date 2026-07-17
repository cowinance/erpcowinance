import { Controller, Get, Param, Query } from '@nestjs/common';
import { FeedlotService } from './feedlot.service';

@Controller('feedlot')
export class FeedlotController {
  constructor(private readonly feedlot: FeedlotService) {}

  @Get('lots')
  lots(@Query('target') target?: string) {
    return this.feedlot.lots(target ? Number(target) : undefined);
  }
  @Get('lots/:id')
  get(@Param('id') id: string, @Query('target') target?: string) {
    return this.feedlot.get(id, target ? Number(target) : undefined);
  }
}
