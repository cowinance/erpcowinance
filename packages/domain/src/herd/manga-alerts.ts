/**
 * Alertas de la tarjeta del animal en modo manga.
 *
 * REGLA ÚNICA para los dos canales. La manga de la web y la del móvil muestran la misma tarjeta al
 * mismo operario, y hasta ahora cada una decidía por su cuenta qué avisar: la web mostraba cinco
 * cosas y el móvil dos. La diferencia no era cosmética — al móvil le faltaba el **retiro activo**,
 * que es justo la alerta que impide mandar a faena o volver a tratar un animal que no corresponde.
 *
 * Cada alerta puede llevar un `mode`: tocarla salta al modo que la resuelve. Un aviso que no se
 * puede accionar obliga al operario a recordar y navegar — con guantes, en la manga, eso es un
 * aviso que se ignora.
 */

export type MangaMode = 'Pesaje' | 'Revisión' | 'Nota' | 'Tratamiento' | 'Vacunación' | 'Movimiento' | 'Reproducción';

export interface MangaCardInput {
  /** Fin del retiro en carne. Lo más grave: define si el animal puede ir a faena. */
  meatWithdrawalUntil?: string | null;
  /** Fin del retiro en leche. */
  milkWithdrawalUntil?: string | null;
  openCases?: number | null;
  caseSeverity?: string | null;
  sex?: string | null;
  expectedDueDate?: string | null;
  lotId?: string | null;
  /** Días desde el último pesaje. `null` = nunca se pesó, que es distinto de "hace mucho". */
  daysSinceWeighing?: number | null;
}

export interface MangaAlert {
  code: 'withdrawal' | 'open_case' | 'calving_soon' | 'no_lot' | 'no_weighing';
  text: string;
  tone: 'danger' | 'warning';
  /** Modo que resuelve la alerta. Ausente cuando no hay nada que capturar (un retiro solo se espera). */
  mode?: MangaMode;
}

/** Días antes del parto en que empieza a avisar, y cuántos tolera pasados sin dejar de avisar. */
const CALVING_WINDOW_BEFORE = 21;
const CALVING_WINDOW_AFTER = -10;

/** Cuántas alertas se muestran. Más de tres en una tarjeta de manga no se leen: se saltean todas. */
export const MAX_CARD_ALERTS = 3;

/**
 * Alertas ordenadas por gravedad. `today` se inyecta para que el resultado sea reproducible: una
 * regla que lee el reloj no se puede probar en el borde, que es donde importa.
 */
export function mangaCardAlerts(a: MangaCardInput, today: Date = new Date()): MangaAlert[] {
  const out: MangaAlert[] = [];
  const hoy = startOfDay(today);

  // 1. Retiro. Va primero y sin modo: no hay nada que capturar, hay que ESPERAR. Es la única que
  //    tiene consecuencia regulatoria y de inocuidad.
  const carne = vigente(a.meatWithdrawalUntil, hoy);
  const leche = vigente(a.milkWithdrawalUntil, hoy);
  if (carne || leche) {
    const partes: string[] = [];
    if (carne) partes.push(`carne hasta ${fecha(a.meatWithdrawalUntil!)}`);
    if (leche) partes.push(`leche hasta ${fecha(a.milkWithdrawalUntil!)}`);
    out.push({ code: 'withdrawal', text: `RETIRO ACTIVO · ${partes.join(' · ')}`, tone: 'danger' });
  }

  // 2. Caso clínico abierto: el animal está enfermo y pasó por la manga. Es el momento de tratarlo.
  if ((a.openCases ?? 0) > 0)
    out.push({
      code: 'open_case',
      text: `CASO ABIERTO${a.caseSeverity === 'severe' ? ' (grave)' : ''} · tratar`,
      tone: 'danger',
      mode: 'Tratamiento',
    });

  // 3. Parto próximo. Solo en hembras y dentro de la ventana: avisar tres meses antes es ruido.
  if (a.sex === 'F' && a.expectedDueDate) {
    const dias = diasHasta(a.expectedDueDate, hoy);
    if (dias <= CALVING_WINDOW_BEFORE && dias >= CALVING_WINDOW_AFTER)
      out.push({
        code: 'calving_soon',
        text: `PARTO PRÓXIMO (${dias <= 0 ? 'vencido' : `${dias} d`})`,
        tone: 'warning',
        mode: 'Reproducción',
      });
  }

  if (!a.lotId) out.push({ code: 'no_lot', text: 'SIN LOTE · mover', tone: 'warning', mode: 'Movimiento' });

  // "Nunca se pesó" y "hace mucho que no se pesa" son cosas distintas y se dicen distinto.
  if (a.daysSinceWeighing == null || a.daysSinceWeighing > 90)
    out.push({
      code: 'no_weighing',
      text: a.daysSinceWeighing == null ? 'SIN PESAJE · pesar' : 'SIN PESAJE RECIENTE · pesar',
      tone: 'warning',
      mode: 'Pesaje',
    });

  return out.slice(0, MAX_CARD_ALERTS);
}

/**
 * Fin de retiro efectivo entre dos fuentes: lo que dijo el servidor y lo que el propio dispositivo
 * capturó sin señal. Gana el MÁS LEJANO — un tratamiento aplicado recién en la manga extiende el
 * retiro, y quedarse con el dato viejo del servidor diría que el animal ya está apto cuando no lo
 * está.
 */
export function latestWithdrawal(...fechas: (string | null | undefined)[]): string | null {
  const validas = fechas.filter((f): f is string => !!f && !Number.isNaN(Date.parse(f)));
  if (validas.length === 0) return null;
  return validas.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

function vigente(hasta: string | null | undefined, hoy: Date): boolean {
  if (!hasta) return false;
  const t = Date.parse(hasta);
  return !Number.isNaN(t) && t >= hoy.getTime();
}

function diasHasta(fechaISO: string, hoy: Date): number {
  return Math.round((startOfDay(new Date(fechaISO)).getTime() - hoy.getTime()) / 86400000);
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `dd/mm` — en la manga alcanza y ocupa menos. */
function fecha(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
