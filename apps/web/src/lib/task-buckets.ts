import { addFarmDays } from './date';

/**
 * En qué columna del tablero cae una tarea por su fecha de vencimiento.
 *
 * Espeja la derivación del backend —el tablero usa el `bucket` que manda el servidor— y acá sirve
 * para una sola cosa: después de crear una tarea, saltar a la pestaña donde quedó. Si eligiera
 * mal, la tarea recién creada «desaparece» a los ojos de quien la creó.
 *
 * **Por qué salió del componente.** Mezclaba dos relojes: el día de hoy venía de `farmToday()` —la
 * zona de la finca— pero la ventana de siete días y el fin de mes se calculaban con
 * `toISOString()`, que es UTC. En Venezuela (UTC−4), después de las 20:00 las dos fronteras se
 * corrían un día, así que una tarea del borde caía en la columna equivocada. Es exactamente el bug
 * que `lib/date` existe para evitar, reintroducido adentro de un componente donde nada lo miraba.
 *
 * Puro: el día de la finca entra por parámetro. Sin eso no hay forma de probar los bordes.
 */
export type TaskBucket = 'overdue' | 'today' | 'next7' | 'month' | 'later' | 'nodate';

/** Último día del mes de una fecha `YYYY-MM-DD`, como fecha de calendario. */
export function endOfMonth(fecha: string): string {
  const [y, m] = fecha.split('-').map(Number);
  // Día 0 del mes siguiente es el último del actual. En UTC para no arrastrar la zona del equipo.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function bucketForDue(due: string | null | undefined, hoy: string): TaskBucket {
  if (!due) return 'nodate';
  const d = due.slice(0, 10);
  if (d < hoy) return 'overdue';
  if (d === hoy) return 'today';
  if (d <= addFarmDays(hoy, 7)) return 'next7';
  return d <= endOfMonth(hoy) ? 'month' : 'later';
}
