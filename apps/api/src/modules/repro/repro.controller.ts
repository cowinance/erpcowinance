import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ReproService } from './repro.service';
import { ProtocolService } from './protocol.service';
import { ReproDashboardService } from './repro-dashboard.service';

@Controller()
export class ReproController {
  constructor(
    private readonly repro: ReproService,
    private readonly protocols: ProtocolService,
    private readonly panel: ReproDashboardService,
  ) {}

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

  /**
   * Revisión de sincronización de una receptora: ¿formó cuerpo lúteo?
   *
   * La que responde recibe embrión —y esa transferencia se anota sola como respuesta—; la que no,
   * se registra acá. Sin este registro, la vaca que falló no deja rastro y no se puede medir cómo
   * anduvo el protocolo.
   */
  @Post('synchronization-checks')
  syncCheck(@Body() body: any) {
    return this.repro.recordSyncCheck(body);
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

  @Get('reproduction/dashboard')
  dashboard() {
    return this.panel.reproDashboard();
  }

  @Get('reproduction/herd-status')
  herdStatus(@Query('lot_id') lotId?: string) {
    return this.repro.herdStatus(lotId);
  }

  @Get('reproduction/animals/:id/status')
  animalStatus(@Param('id') id: string) {
    return this.repro.animalStatus(id);
  }

  @Get('reproduction/to-prepare')
  toPrepare(@Query('days') days?: string) {
    return this.repro.toPrepare(days ? Number(days) : undefined);
  }

  @Get('reproduction/by-lot')
  byLot() {
    return this.repro.reproByLot();
  }

  @Get('reproduction/protocols')
  listProtocols() {
    return this.protocols.listProtocols();
  }

  @Post('reproduction/protocols')
  createProtocol(@Body() body: any) {
    return this.protocols.createProtocol(body);
  }

  @Patch('reproduction/protocols/:id')
  updateProtocol(@Param('id') id: string, @Body() body: any) {
    return this.protocols.updateProtocol(id, body);
  }

  @Delete('reproduction/protocols/:id')
  deleteProtocol(@Param('id') id: string) {
    return this.protocols.deleteProtocol(id);
  }

  @Get('reproduction/protocol-assignments')
  listAssignments() {
    return this.protocols.listAssignments();
  }

  @Post('reproduction/protocol-assignments')
  assignProtocol(@Body() body: any) {
    return this.protocols.assignProtocol(body);
  }

  @Post('reproduction/protocol-assignments/:id/cancel')
  cancelAssignment(@Param('id') id: string) {
    return this.protocols.cancelAssignment(id);
  }

  @Get('reproduction/protocol-assignments/:id/progress')
  progress(@Param('id') id: string) {
    return this.protocols.assignmentProgress(id);
  }

  @Post('reproduction/protocol-assignments/:id/steps/:index/complete')
  completeStep(@Param('id') id: string, @Param('index') index: string, @Body() body: any) {
    return this.protocols.completeStep(id, Number(index), body);
  }
}
