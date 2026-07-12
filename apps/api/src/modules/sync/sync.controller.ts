import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SyncService } from './sync.service';

/** API de sincronización (doc APIs §7). En prod: Protobuf+zstd sobre HTTP/2; v0: JSON. */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('devices')
  register(@Body() body: any) {
    return this.sync.registerDevice(body);
  }

  @Post('devices/:id/push-token')
  setPushToken(@Param('id') id: string, @Body() body: any) {
    return this.sync.setPushToken(id, body?.push_token);
  }

  @Post('push')
  push(@Body() body: any) {
    return this.sync.push(body);
  }

  @Get('pull')
  pull(@Query('device_id') deviceId: string, @Query('cursor') cursor?: string) {
    return this.sync.pull(deviceId, Number(cursor ?? 0));
  }

  @Get('bootstrap')
  bootstrap(@Query('device_id') deviceId: string) {
    return this.sync.bootstrap(deviceId);
  }

  @Get('state')
  state() {
    return this.sync.state();
  }

  @Get('conflicts')
  conflicts() {
    return this.sync.conflicts();
  }

  @Post('resolve')
  resolve(@Body() body: any) {
    return this.sync.resolve(body);
  }
}
