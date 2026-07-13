import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ReproService } from './repro.service';

@Controller()
export class ReproController {
  constructor(private readonly repro: ReproService) {}

  @Post('animals/:id/heats')
  heat(@Param('id') id: string, @Body() body: any) {
    return this.repro.heat(id, body);
  }

  @Post('animals/:id/services')
  service(@Param('id') id: string, @Body() body: any) {
    return this.repro.service(id, body);
  }

  @Post('pregnancy-diagnoses')
  diagnose(@Body() body: any) {
    return this.repro.diagnose(body);
  }

  @Post('calvings')
  calving(@Body() body: any) {
    return this.repro.calving(body);
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
