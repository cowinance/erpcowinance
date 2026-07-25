import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';

/** CRM (F3): contactos, interacciones, pipeline y contratos sobre la base de socios comerciales. */
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('summary')
  summary(@Query('expiry_days') expiryDays?: string) {
    return this.crm.summary({ expiryWindowDays: numberOr(expiryDays) });
  }

  // ── Contactos ─────────────────────────────────────────────────────────────

  @Get('partners/:id/contacts')
  contacts(@Param('id') id: string) {
    return this.crm.contacts(id);
  }

  @Post('partners/:id/contacts')
  addContact(@Param('id') id: string, @Body() body: any) {
    return this.crm.addContact(id, body);
  }

  @Delete('contacts/:id')
  removeContact(@Param('id') id: string) {
    return this.crm.removeContact(id);
  }

  @Patch('partners/:id/segment')
  setSegment(@Param('id') id: string, @Body() body: any) {
    return this.crm.setSegment(id, body?.segment ?? null);
  }

  // ── Interacciones ─────────────────────────────────────────────────────────

  @Get('interactions')
  interactions(@Query('partner_id') partnerId?: string, @Query('limit') limit?: string) {
    return this.crm.interactions({ partnerId: partnerId || undefined, limit: numberOr(limit) });
  }

  @Post('interactions')
  logInteraction(@Body() body: any) {
    return this.crm.logInteraction(body);
  }

  @Get('follow-ups')
  followUps(@Query('until') until?: string) {
    return this.crm.followUps({ until: until || undefined });
  }

  // ── Oportunidades ─────────────────────────────────────────────────────────

  @Get('opportunities')
  opportunities(@Query('stage') stage?: string, @Query('partner_id') partnerId?: string, @Query('open') open?: string) {
    return this.crm.opportunities({
      stage: stage || undefined,
      partnerId: partnerId || undefined,
      open: open === 'true' ? true : undefined,
    });
  }

  @Post('opportunities')
  createOpportunity(@Body() body: any) {
    return this.crm.createOpportunity(body);
  }

  @Patch('opportunities/:id/stage')
  moveStage(@Param('id') id: string, @Body() body: any) {
    return this.crm.moveStage(id, body);
  }

  @Get('opportunities/:id/history')
  history(@Param('id') id: string) {
    return this.crm.opportunityHistory(id);
  }

  // ── Contratos ─────────────────────────────────────────────────────────────

  @Get('contracts')
  contracts(@Query('partner_id') partnerId?: string, @Query('expiry_days') expiryDays?: string) {
    return this.crm.contracts({ partnerId: partnerId || undefined, expiryWindowDays: numberOr(expiryDays) });
  }

  @Post('contracts')
  createContract(@Body() body: any) {
    return this.crm.createContract(body);
  }

  @Patch('contracts/:id/status')
  setContractStatus(@Param('id') id: string, @Body() body: any) {
    return this.crm.setContractStatus(id, String(body?.status ?? ''));
  }
}

function numberOr(v?: string): number | undefined {
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
}
