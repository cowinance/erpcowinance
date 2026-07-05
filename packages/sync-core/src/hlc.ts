/**
 * Hybrid Logical Clock (HLC) — doc Arquitectura §12.2.
 * Ordena eventos entre dispositivos sin depender de la hora del sistema.
 *
 * Codificación como string ordenable lexicográficamente:
 *   "mmmmmmmmmmmmmm:cccccc:node"  (ms en 14 dígitos, contador en 6 hex, id de nodo)
 * Dos HLC de nodos distintos jamás son iguales → orden total determinista.
 */

export interface HlcParts {
  ms: number;
  count: number;
  node: string;
}

export function hlcEncode(p: HlcParts): string {
  return `${p.ms.toString().padStart(14, '0')}:${p.count.toString(16).padStart(6, '0')}:${p.node}`;
}

export function hlcParse(s: string): HlcParts {
  const i = s.indexOf(':');
  const j = s.indexOf(':', i + 1);
  return { ms: Number(s.slice(0, i)), count: parseInt(s.slice(i + 1, j), 16), node: s.slice(j + 1) };
}

export function hlcNode(s: string): string {
  return s.slice(s.indexOf(':', s.indexOf(':') + 1) + 1);
}

/** Comparación total: ms → contador → nodo (los campos numéricos están padded, sirve el orden de string). */
export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private lastMs = 0;
  private count = 0;

  constructor(
    public readonly node: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Genera un nuevo timestamp local (evento propio). */
  tick(): string {
    const wall = this.now();
    if (wall > this.lastMs) {
      this.lastMs = wall;
      this.count = 0;
    } else {
      this.count++;
    }
    return hlcEncode({ ms: this.lastMs, count: this.count, node: this.node });
  }

  /** Incorpora un timestamp remoto (regla de recepción HLC). */
  receive(remote: string): void {
    const r = hlcParse(remote);
    const wall = this.now();
    if (wall > this.lastMs && wall > r.ms) {
      this.lastMs = wall;
      this.count = 0;
    } else if (r.ms > this.lastMs) {
      this.lastMs = r.ms;
      this.count = r.count + 1;
    } else if (r.ms === this.lastMs) {
      this.count = Math.max(this.count, r.count) + 1;
    } else {
      this.count++;
    }
  }
}
