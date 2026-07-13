/**
 * Tiempo relativo en español, puro y sin dependencias de React Native, Expo ni librerías de
 * fechas (P7-4.c.2, D6). `now` inyectable para determinismo en tests. Tolera fecha inválida
 * devolviendo '' (nunca lanza). Consumido por AgendaToday y la pantalla de Notificaciones —
 * una sola fuente de verdad para la semántica reciente/minutos/horas/días.
 */
export function relativeTime(value: string | Date, now: Date = new Date()): string {
  const then = value instanceof Date ? value : new Date(value);
  const t = then.getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
