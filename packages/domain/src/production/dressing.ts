/**
 * Rendimiento de faena (FA-1) — REGLA ÚNICA derivada.
 *
 * `dressing_pct = peso de res caliente ÷ último peso vivo × 100`. Nunca se acepta del cliente: lo
 * calcula el servidor cruzando la faena con la última pesada del animal (Producción/GDP). Si el animal
 * no tiene pesadas, el rendimiento es `null` — no se inventa un número.
 *
 * Invariante física: una res no puede pesar más que el animal vivo (rendimiento > 100% = dato erróneo).
 */
export class InvalidCarcassError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'InvalidCarcassError';
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Rendimiento en % (2 decimales), o `null` si no hay peso vivo con el que derivarlo.
 * Lanza `InvalidCarcassError` si el peso de res es inválido o supera al peso vivo.
 */
export function computeDressingPct(carcassKg: number, liveKg: number | null | undefined): number | null {
  const carcass = Number(carcassKg);
  if (!Number.isFinite(carcass) || carcass <= 0) throw new InvalidCarcassError('El peso de res debe ser positivo');
  if (liveKg == null) return null;
  const live = Number(liveKg);
  if (!Number.isFinite(live) || live <= 0) return null;
  if (carcass > live) throw new InvalidCarcassError(`La res (${carcass} kg) no puede pesar más que el animal vivo (${live} kg)`);
  return round2((carcass / live) * 100);
}
