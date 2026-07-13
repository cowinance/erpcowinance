/**
 * Calendario previsto de protocolos (R-2.b.2), PURO y sin React. Proyecta `start_date + step.day`
 * como FECHA OPERATIVA local (no un instante UTC arbitrario): la aritmética es en componentes de
 * calendario (base UTC + días) y el formateo fija `timeZone: 'UTC'`, de modo que el día elegido por
 * el usuario nunca se desplaza por zona horaria.
 *
 * Limitación consciente (R-2.b.1 no snapshotea los pasos: la asignación guarda solo protocol_id):
 * el calendario usa los pasos ACTUALES de la plantilla. Si una plantilla se edita tras asignarla,
 * la proyección cambia. Por eso es «Calendario previsto», no un historial inmutable. El
 * snapshot/versionado de protocolos es trabajo futuro, NO parte de esta ola.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Suma `days` días de calendario a un `YYYY-MM-DD` y devuelve `YYYY-MM-DD`. null si la fecha es
 *  inválida. Sin desplazamiento por timezone (todo en UTC, formateado desde componentes UTC). */
export function addCalendarDays(ymd: string, days: number): string | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    da = +m[3];
  const base = new Date(Date.UTC(y, mo - 1, da));
  if (base.getUTCFullYear() !== y || base.getUTCMonth() !== mo - 1 || base.getUTCDate() !== da) return null; // p. ej. 02-30
  if (!Number.isInteger(days)) return null;
  const d = new Date(base.getTime() + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Formatea `YYYY-MM-DD` en español SIN conversión a zona local (timeZone UTC). '' si inválida. */
export function formatCalendarEs(ymd: string): string {
  const m = YMD.exec(ymd);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

export interface CalendarAssignment {
  id: string;
  protocol_id: string;
  protocol_name?: string | null;
  lot_name?: string | null;
  start_date: string;
  status: string;
}
export interface CalendarProtocol {
  id: string;
  name: string;
  steps: { day: number; action: string }[];
}
export interface CalendarItem {
  assignment_id: string;
  date: string; // YYYY-MM-DD
  day: number;
  action: string;
  lot: string;
  protocol: string;
}

/**
 * Construye el calendario previsto: por cada asignación ACTIVA, cada paso de su plantilla con fecha
 * ≥ `today`. Relaciona por `protocol_id` contra el catálogo (Map); una asignación cuyo protocolo no
 * esté disponible simplemente no aporta pasos (la lista de asignaciones la muestra igual). Sin N+1.
 * Orden determinista: fecha asc, lote, día, acción. `today` = 'YYYY-MM-DD' calculado una vez.
 */
export function buildProtocolCalendar(
  assignments: readonly CalendarAssignment[],
  protocolsById: Map<string, CalendarProtocol>,
  today: string,
): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const a of assignments) {
    if (a.status !== 'active') continue;
    const proto = protocolsById.get(a.protocol_id);
    if (!proto) continue;
    const start = String(a.start_date ?? '').slice(0, 10);
    for (const s of proto.steps ?? []) {
      const date = addCalendarDays(start, Number(s.day));
      if (!date || date < today) continue;
      items.push({ assignment_id: a.id, date, day: Number(s.day), action: s.action, lot: a.lot_name ?? '—', protocol: a.protocol_name ?? proto.name });
    }
  }
  items.sort((x, y) => x.date.localeCompare(y.date) || x.lot.localeCompare(y.lot) || x.day - y.day || x.action.localeCompare(y.action));
  return items;
}
