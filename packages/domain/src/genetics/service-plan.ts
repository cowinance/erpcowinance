/**
 * Plan de servicio por animal (GT-3): qué se le va a poner a cada vientre, y de dónde sale.
 *
 * Hasta acá, servir un lote aplicaba UN toro a todo el grupo. El plan lo reemplaza: la 001 va con
 * el embrión del termo 207, la 002 con semen de otro toro, y cada una con su pajuela concreta
 * reservada desde antes.
 *
 * La consecuencia de fondo es la reserva: una pajuela asignada sigue físicamente en el termo pero
 * ya tiene dueña. Sin eso se pueden planificar 30 servicios sobre 20 pajuelas, y el problema
 * aparece recién en el corral, con los animales ya sincronizados y sin vuelta atrás.
 */

export const PLAN_METHODS = ['ai', 'embryo_transfer'] as const;
export type PlanMethod = (typeof PLAN_METHODS)[number];

/** Resultado de la revisión: si el vientre entra o no a la jornada. */
export const ELIGIBILITY = ['pending', 'eligible', 'not_eligible'] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export const PLAN_STATUSES = ['planned', 'served', 'released'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export class InvalidServicePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidServicePlanError';
  }
}

export interface PlanEntryInput {
  animal_id: string;
  method: PlanMethod;
  semen_batch_id: string | null;
  embryo_id: string | null;
  straw_id: string | null;
}

/**
 * Una entrada del plan. El método y el origen tienen que concordar: inseminar pide una partida de
 * semen, transferir pide un embrión. Aceptar la combinación cruzada dejaría un plan que no se puede
 * ejecutar, y eso se descubriría con la vaca en la manga.
 */
export function validatePlanEntry(raw: any): PlanEntryInput {
  const animal_id = typeof raw?.animal_id === 'string' && raw.animal_id.trim() ? raw.animal_id.trim() : null;
  if (!animal_id) throw new InvalidServicePlanError("'animal_id' es obligatorio");

  const method = raw?.method;
  if (!PLAN_METHODS.includes(method))
    throw new InvalidServicePlanError(`'method' debe ser ${PLAN_METHODS.join(' o ')}`);

  const semen = typeof raw?.semen_batch_id === 'string' && raw.semen_batch_id.trim() ? raw.semen_batch_id.trim() : null;
  const embryo = typeof raw?.embryo_id === 'string' && raw.embryo_id.trim() ? raw.embryo_id.trim() : null;

  if (method === 'ai' && (!semen || embryo))
    throw new InvalidServicePlanError('Para inseminar hay que indicar una partida de semen, y solo eso.');
  if (method === 'embryo_transfer' && (!embryo || semen))
    throw new InvalidServicePlanError('Para transferir hay que indicar un embrión, y solo eso.');

  return {
    animal_id,
    method,
    semen_batch_id: semen,
    embryo_id: embryo,
    straw_id: typeof raw?.straw_id === 'string' && raw.straw_id.trim() ? raw.straw_id.trim() : null,
  };
}

/**
 * ¿Esta entrada del plan tiene que soltar su pajuela?
 *
 * Sí en cuanto el vientre queda fuera de la jornada. Si la liberación no fuera automática, cada
 * campaña dejaría reservas de animales que nunca se sirvieron, y en tres campañas el «libre» del
 * termo no significaría nada.
 */
export function shouldReleaseReservation(eligibility: Eligibility, status: PlanStatus): boolean {
  return status === 'planned' && eligibility === 'not_eligible';
}

export interface PickingLine {
  tank_code: string | null;
  canister_code: string | null;
  canister_color: string | null;
  goblet_code: string | null;
  straws: { straw_id: string; animal_tag: string | null; origin_label: string }[];
}

/**
 * Lista de retiro: qué sacar del termo, agrupado por posición.
 *
 * Se agrupa por gobelete y no por animal porque el orden en que se saca no es el orden en que se
 * sirve: cada apertura del termo evapora nitrógeno, así que conviene abrir una vez por posición y
 * llevarse todo junto, no ir y volver por cada vaca.
 */
export function buildPickingList(
  rows: readonly {
    straw_id: string;
    animal_tag: string | null;
    origin_label: string;
    tank_code: string | null;
    canister_code: string | null;
    canister_color: string | null;
    goblet_code: string | null;
  }[],
): PickingLine[] {
  const porPosicion = new Map<string, PickingLine>();
  for (const r of rows) {
    const clave = `${r.tank_code ?? ''}|${r.canister_code ?? ''}|${r.goblet_code ?? ''}`;
    const linea =
      porPosicion.get(clave) ??
      ({
        tank_code: r.tank_code,
        canister_code: r.canister_code,
        canister_color: r.canister_color,
        goblet_code: r.goblet_code,
        straws: [],
      } as PickingLine);
    linea.straws.push({ straw_id: r.straw_id, animal_tag: r.animal_tag, origin_label: r.origin_label });
    porPosicion.set(clave, linea);
  }
  // Orden de recorrido del termo: primero por termo, después canasta, después gobelete. Lo que no
  // tiene posición va al final, porque no se puede ir a buscar.
  return [...porPosicion.values()].sort((a, b) => {
    const sinPos = (x: PickingLine) => (x.goblet_code === null ? 1 : 0);
    return (
      sinPos(a) - sinPos(b) ||
      (a.tank_code ?? '').localeCompare(b.tank_code ?? '') ||
      (a.canister_code ?? '').localeCompare(b.canister_code ?? '') ||
      (a.goblet_code ?? '').localeCompare(b.goblet_code ?? '')
    );
  });
}

export interface CampaignSummary {
  total: number;
  pending_review: number;
  eligible: number;
  not_eligible: number;
  planned: number;
  served: number;
  /** Planificados sin pajuela reservada: no se pueden ejecutar tal como están. */
  without_straw: number;
}

/**
 * Estado de la campaña de un vistazo.
 *
 * `without_straw` está aparte porque es el único número accionable ANTES de la jornada: una entrada
 * planificada sin pajuela reservada es una vaca que va a llegar a la manga sin nada con qué
 * servirla, y eso se arregla en la oficina, no en el corral.
 */
export function summarizeCampaign(
  rows: readonly { eligibility: Eligibility; status: PlanStatus | null; straw_id: string | null }[],
): CampaignSummary {
  return {
    total: rows.length,
    pending_review: rows.filter((r) => r.eligibility === 'pending').length,
    eligible: rows.filter((r) => r.eligibility === 'eligible').length,
    not_eligible: rows.filter((r) => r.eligibility === 'not_eligible').length,
    planned: rows.filter((r) => r.status === 'planned').length,
    served: rows.filter((r) => r.status === 'served').length,
    without_straw: rows.filter((r) => r.status === 'planned' && r.straw_id === null).length,
  };
}
