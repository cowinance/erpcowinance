import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ReproService } from './repro.service';

@Controller()
export class ReproController {
  constructor(private readonly repro: ReproService) {}

  @Post('animals/:id/heats')
  heat(@Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.heat(id, body, key);
  }

  @Post('animals/:id/services')
  service(@Param('id') id: string, @Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.service(id, body, key);
  }

  @Post('reproduction/services/bulk')
  bulkService(@Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.bulkService(body, key);
  }

  @Get('reproduction/heats-not-served')
  heatsNotServed(@Query('days') days?: string) {
    return this.repro.heatsNotServed(days ? Number(days) : undefined);
  }

  @Post('pregnancy-diagnoses')
  diagnose(@Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.diagnose(body, key);
  }

  @Post('abortions')
  abortion(@Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.abortion(body, key);
  }

  @Post('calvings')
  calving(@Body() body: any, @Headers('idempotency-key') key?: string) {
    return this.repro.calving(body, key);
  }

  @Post('weanings')
  weaning(@Body() body: any) {
    return this.repro.weaning(body);
  }

  @Get('pregnancies')
  pregnancies() {
    return this.repro.pregnancies();
  }

  @Get('reproduction/upcoming-calvings')
  upcoming(@Query('days') days?: string) {
    return this.repro.upcomingCalvings(days ? Number(days) : undefined);
  }

  @Get('reproduction/kpis')
  kpis() {
    return this.repro.kpis();
  }

  @Get('reproduction/herd-status')
  herdStatus(@Query('lot_id') lotId?: string) {
    return this.repro.herdStatus(lotId);
  }

  @Get('reproduction/to-prepare')
  toPrepare(@Query('days') days?: string) {
    return this.repro.toPrepare(days ? Number(days) : undefined);
  }

  @Get('reproduction/protocols')
  listProtocols() {
    return this.repro.listProtocols();
  }

  @Post('reproduction/protocols')
  createProtocol(@Body() body: any) {
    return this.repro.createProtocol(body);
  }

  @Patch('reproduction/protocols/:id')
  updateProtocol(@Param('id') id: string, @Body() body: any) {
    return this.repro.updateProtocol(id, body);
  }

  @Delete('reproduction/protocols/:id')
  deleteProtocol(@Param('id') id: string) {
    return this.repro.deleteProtocol(id);
  }

  @Get('reproduction/protocol-assignments')
  listAssignments() {
    return this.repro.listAssignments();
  }

  @Post('reproduction/protocol-assignments')
  assignProtocol(@Body() body: any) {
    return this.repro.assignProtocol(body);
  }

  @Post('reproduction/protocol-assignments/:id/cancel')
  cancelAssignment(@Param('id') id: string) {
    return this.repro.cancelAssignment(id);
  }
}
