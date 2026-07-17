/**
 * Lotes / rodeos (B1 · Hato). Un lote es un grupo de manejo con un propósito (cría, engorde, tambo,
 * recría, cuarentena, hospital), opcionalmente ubicado en un potrero. Acá se valida y normaliza la
 * entrada; la composición y los agregados los deriva el servicio.
 */
export const LOT_PURPOSES = ['breeding', 'fattening', 'dairy', 'weaning', 'quarantine', 'hospital'] as const;
export type LotPurpose = (typeof LOT_PURPOSES)[number];

export class InvalidLotError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidLotError';
  }
}

/** Valida el propósito: opcional, pero si viene debe pertenecer al enum. */
export function assertLotPurpose(purpose: unknown): LotPurpose | null {
  if (purpose == null || purpose === '') return null;
  if (!(LOT_PURPOSES as readonly string[]).includes(String(purpose))) {
    throw new InvalidLotError(`Propósito de lote inválido: ${String(purpose)}`);
  }
  return purpose as LotPurpose;
}

export interface LotInput {
  name: string;
  purpose: LotPurpose | null;
}

export function validateLotInput(input: { name?: unknown; purpose?: unknown }): LotInput {
  const name = String(input.name ?? '').trim();
  if (!name) throw new InvalidLotError('El nombre del lote es obligatorio');
  if (name.length > 255) throw new InvalidLotError('El nombre no puede superar 255 caracteres');
  return { name, purpose: assertLotPurpose(input.purpose) };
}
