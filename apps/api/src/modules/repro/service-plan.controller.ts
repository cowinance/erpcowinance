import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { Eligibility } from '@cowinance/domain';
import { ServicePlanService } from './service-plan.service';

/**
 * Plan de servicio por animal (GT-3).
 *
 * Todo cuelga de la CAMPAÑA (la asignación de protocolo a un lote) porque un plan fuera de su
 * campaña no significa nada: «apta» o «va con el toro X» son afirmaciones sobre una jornada
 * concreta, no sobre el animal.
 */
@Controller('reproduction/campaigns')
export class ServicePlanController {
  constructor(private readonly plans: ServicePlanService) {}

  /**
   * Tasa de concepción por toro sobre todas las campañas. Va antes de `:id` porque una ruta
   * estática después de una paramétrica nunca se alcanza — ya nos pasó.
   */
  @Get('conception-by-sire')
  conceptionBySire() {
    return this.plans.conceptionBySire();
  }

  @Get(':id')
  campaign(@Param('id') id: string) {
    return this.plans.campaign(id);
  }

  /** Lo que hay que sacar del termo, agrupado por posición: un viaje por gobelete. */
  @Get(':id/picking-list')
  pickingList(@Param('id') id: string) {
    return this.plans.pickingList(id);
  }

  /** Resultado de la revisión. Marcar «no apta» suelta la pajuela en el mismo movimiento. */
  @Put(':id/animals/:animalId/eligibility')
  setEligibility(@Param('id') id: string, @Param('animalId') animalId: string, @Body() body: any) {
    return this.plans.setEligibility(id, animalId, body?.eligibility as Eligibility, body?.notes);
  }

  /** Cierre de la campaña: quiénes quedaron preñadas y con qué toro (GT-3b). */
  @Get(':id/outcome')
  outcome(@Param('id') id: string) {
    return this.plans.outcome(id);
  }

  @Post(':id/plan')
  plan(@Param('id') id: string, @Body() body: any) {
    return this.plans.plan(id, body);
  }

  @Delete(':id/animals/:animalId/plan')
  unplan(@Param('id') id: string, @Param('animalId') animalId: string) {
    return this.plans.unplan(id, animalId);
  }
}
