/**
 * Vigencia de contratos comerciales (F3). El catálogo pide «contratos con vigencia y alertas» y
 * «contratos por vencer» como indicador: las dos cosas salen de acá.
 */

export const CONTRACT_TYPES = ['supply', 'lease', 'capitalization', 'agistment', 'service', 'other'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Estado ALMACENADO. Lo decide una persona: firmar, dar de alta, rescindir. */
export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface ContractLike {
  status: ContractStatus;
  start_date: string;
  /** Sin fecha de fin: contrato abierto, no vence. */
  end_date?: string | null;
  value?: number | null;
}

/**
 * Vigencia DERIVADA de las fechas, separada del estado almacenado.
 *
 * Son dos cosas distintas y mezclarlas obligaría a un job que "vence" contratos a medianoche —y a
 * que un contrato quede mal si ese job no corrió. Rescindir es una decisión (estado); vencer es el
 * paso del tiempo (derivado). Mismo criterio que `is_expired` en certificaciones (T-2).
 */
export type ContractStanding = 'draft' | 'upcoming' | 'active' | 'expiring_soon' | 'expired' | 'terminated';

/** Ventana de aviso por defecto: 30 días es el plazo típico de preaviso de renovación. */
export const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

export function contractStanding(
  contract: ContractLike,
  today: string,
  windowDays = DEFAULT_EXPIRY_WINDOW_DAYS,
): ContractStanding {
  // Rescindido y borrador son decisiones humanas: ganan sobre cualquier cálculo de fechas.
  if (contract.status === 'terminated') return 'terminated';
  if (contract.status === 'draft') return 'draft';

  if (contract.start_date > today) return 'upcoming';
  if (!contract.end_date) return 'active';
  if (contract.end_date < today) return 'expired';

  return daysBetween(today, contract.end_date) <= windowDays ? 'expiring_soon' : 'active';
}

/** ¿Cuenta como vigente hoy? Es lo que define «contratos activos» y el valor de la cartera. */
export function isCurrent(standing: ContractStanding): boolean {
  return standing === 'active' || standing === 'expiring_soon';
}

export interface ContractsSummary {
  active: number;
  expiringSoon: number;
  expired: number;
  /** Valor de los contratos vigentes. `null` si ninguno tiene valor cargado. */
  currentValue: number | null;
  /** Vigentes SIN valor: lo que la cartera no puede contar. */
  currentWithoutValue: number;
}

export function summarizeContracts(
  contracts: ContractLike[],
  today: string,
  windowDays = DEFAULT_EXPIRY_WINDOW_DAYS,
): ContractsSummary {
  let active = 0;
  let expiringSoon = 0;
  let expired = 0;
  let currentValue: number | null = null;
  let currentWithoutValue = 0;

  for (const c of contracts) {
    const standing = contractStanding(c, today, windowDays);
    if (standing === 'expiring_soon') expiringSoon++;
    else if (standing === 'active') active++;
    else if (standing === 'expired') expired++;

    if (isCurrent(standing)) {
      if (c.value == null) currentWithoutValue++;
      else currentValue = (currentValue ?? 0) + c.value;
    }
  }

  return {
    active,
    expiringSoon,
    expired,
    currentValue: currentValue == null ? null : Math.round(currentValue * 100) / 100,
    currentWithoutValue,
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}
