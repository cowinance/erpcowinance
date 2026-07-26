/**
 * La venta avisa de la certificación ANTES de cerrarse (Fase 3.3).
 *
 * Hoy el problema se descubre tarde: la venta se cierra, los animales salen y en el control aparece
 * que la certificación estaba vencida o que ese lote nunca estuvo cubierto. Para entonces ya hay un
 * camión parado, y el dato que hacía falta estaba cargado en el sistema desde hacía meses.
 *
 * **Lo que esta regla NO hace: decidir que una certificación es obligatoria.** El sistema no sabe
 * qué le exige el comprador — eso cambia con el mercado, el destino y hasta el frigorífico. Afirmar
 * «falta la certificación X» sería inventar una obligación, y un aviso que a veces es falso enseña
 * a cerrarlo sin leerlo.
 *
 * Lo que sí sabe, y es un hecho verificable: **qué esquemas mantiene la finca** y **cuáles de esos
 * no cubren a los animales de esta venta**. Eso es lo que informa. La decisión de si importa sigue
 * siendo del productor, que es el único que conoce a su comprador.
 *
 * Por la misma razón NUNCA bloquea: devuelve avisos. Una venta a un comprador local que no pide
 * nada tiene que poder cerrarse sin pelear con el sistema.
 *
 * Puro, sin IO.
 */

export type CertificationVerdict =
  /** Todos los animales cubiertos y vigente a la fecha de la venta. */
  | 'ok'
  /** Hay cobertura, pero venció antes de la fecha de la venta. */
  | 'vencida'
  /** Vigente ahora, vence dentro de la ventana de aviso: importa si la entrega es más adelante. */
  | 'por_vencer'
  /** La certificación existe pero está suspendida o revocada: no ampara. */
  | 'suspendida'
  /** Cubre a algunos animales de la venta y a otros no. */
  | 'parcial'
  /** Ningún animal de la venta está cubierto por este esquema. */
  | 'sin_cobertura';

/** Una certificación ya resuelta contra un animal concreto (finca, lote o animal). */
export interface CertificationCoverage {
  scheme: string;
  animalId: string;
  scope: 'farm' | 'lot' | 'animal';
  status: 'active' | 'suspended' | 'revoked';
  /** `null` = sin vencimiento cargado. No se supone vigente ni vencida: se informa aparte. */
  validUntil: string | null;
}

export interface SaleCertificationInput {
  /** Fecha contra la que se juzga la vigencia. */
  saleDate: string;
  animalIds: string[];
  /** Esquemas que la finca mantiene. Si está vacío, no hay nada contra qué contrastar. */
  schemes: string[];
  coverage: CertificationCoverage[];
  /** Días de anticipación para avisar «por vencer». Mismo defecto que la alerta de compliance. */
  expiringWithinDays?: number;
}

export interface SchemeCheck {
  scheme: string;
  verdict: CertificationVerdict;
  coveredAnimals: number;
  totalAnimals: number;
  /** El vencimiento más próximo entre las certificaciones que amparan esta venta. */
  earliestValidUntil: string | null;
  /** Animales sin cobertura vigente, para poder nombrarlos en la pantalla. */
  uncoveredAnimalIds: string[];
  message: string;
}

export interface SaleCertificationCheck {
  /** `true` si hay al menos un esquema con algo que mirar. NUNCA bloquea la venta. */
  hasWarnings: boolean;
  schemes: SchemeCheck[];
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Contrasta los animales de una venta contra los esquemas que la finca mantiene.
 *
 * El orden de los veredictos no es alfabético ni casual: primero lo que ya es un problema (vencida,
 * suspendida, sin cobertura), después lo que puede serlo (parcial, por vencer), y al final lo que
 * está bien. Quien abre la venta con el camión esperando tiene que ver arriba lo que lo frena.
 */
export function assessSaleCertifications(input: SaleCertificationInput): SaleCertificationCheck {
  const total = input.animalIds.length;
  const limite = addDays(input.saleDate, input.expiringWithinDays ?? 30);

  const schemes = input.schemes.map<SchemeCheck>((scheme) => {
    const delEsquema = input.coverage.filter((c) => c.scheme === scheme);
    const cubiertos = new Set<string>();
    const suspendidos = new Set<string>();
    const vencidos = new Set<string>();
    let masProximo: string | null = null;

    for (const id of input.animalIds) {
      const suyas = delEsquema.filter((c) => c.animalId === id);
      if (suyas.length === 0) continue;
      // Un animal puede estar amparado por la certificación de la finca Y por una propia. Vale la
      // MEJOR: alcanza con que una lo cubra, y sería absurdo avisar por la peor de dos.
      const vigentes = suyas.filter((c) => c.status === 'active' && (c.validUntil == null || c.validUntil >= input.saleDate));
      if (vigentes.length > 0) {
        cubiertos.add(id);
        for (const v of vigentes) if (v.validUntil != null && (masProximo == null || v.validUntil < masProximo)) masProximo = v.validUntil;
        continue;
      }
      if (suyas.some((c) => c.status !== 'active')) suspendidos.add(id);
      else vencidos.add(id);
    }

    const sinCobertura = input.animalIds.filter((id) => !cubiertos.has(id));
    const verdict = decidir({ total, cubiertos: cubiertos.size, suspendidos: suspendidos.size, vencidos: vencidos.size, masProximo, limite });
    return {
      scheme,
      verdict,
      coveredAnimals: cubiertos.size,
      totalAnimals: total,
      earliestValidUntil: masProximo,
      uncoveredAnimalIds: sinCobertura,
      message: mensaje(scheme, verdict, cubiertos.size, total, masProximo),
    };
  });

  const ORDEN: CertificationVerdict[] = ['vencida', 'suspendida', 'sin_cobertura', 'parcial', 'por_vencer', 'ok'];
  schemes.sort((a, b) => ORDEN.indexOf(a.verdict) - ORDEN.indexOf(b.verdict));
  return { hasWarnings: schemes.some((s) => s.verdict !== 'ok'), schemes };
}

function decidir(o: { total: number; cubiertos: number; suspendidos: number; vencidos: number; masProximo: string | null; limite: string }): CertificationVerdict {
  if (o.total === 0 || o.cubiertos === 0) {
    // Sin ningún animal cubierto, el motivo importa: una certificación vencida se renueva, una
    // revocada es otro problema, y «nunca la tuvieron» es un tercero. Decir siempre lo mismo
    // mandaría al productor a buscar en el lugar equivocado.
    if (o.vencidos > 0) return 'vencida';
    if (o.suspendidos > 0) return 'suspendida';
    return 'sin_cobertura';
  }
  if (o.cubiertos < o.total) return 'parcial';
  if (o.masProximo != null && o.masProximo <= o.limite) return 'por_vencer';
  return 'ok';
}

function mensaje(scheme: string, verdict: CertificationVerdict, cubiertos: number, total: number, masProximo: string | null): string {
  const sinCubrir = total - cubiertos;
  switch (verdict) {
    case 'vencida':
      return `${scheme}: la certificación que ampara a estos animales está vencida. Renovarla antes de despachar evita que el problema aparezca en el control.`;
    case 'suspendida':
      return `${scheme}: la certificación existe pero está suspendida o revocada, así que no ampara esta venta.`;
    case 'sin_cobertura':
      return `${scheme}: tu finca mantiene este esquema y ninguno de los ${total} animales de esta venta está cubierto. Puede ser correcto —depende de qué pida el comprador—, pero conviene revisarlo antes de cerrar.`;
    case 'parcial':
      return `${scheme}: ${cubiertos} de ${total} animales cubiertos. ${sinCubrir} quedan afuera, y una venta mixta suele resolverse peor en el control que una entera sin certificar.`;
    case 'por_vencer':
      return `${scheme}: vigente, pero vence el ${masProximo}. Si la entrega es después de esa fecha, deja de amparar.`;
    case 'ok':
      return `${scheme}: los ${total} animales están cubiertos y la certificación está vigente.`;
  }
}
