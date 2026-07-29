import type { AgendaItemDto, Desired } from './alerts.types';

/**
 * La proyección de `desired` a agenda: pura, sin base y sin reloj.
 *
 * Vive aparte del motor porque no es parte de él. El motor DERIVA qué debería pasar en la finca;
 * esto elige qué de eso se le muestra al productor en su día y en qué orden. Son dos decisiones
 * distintas y cambian por motivos distintos: se agrega una regla sanitaria sin tocar el orden de la
 * agenda, y se cambia el orden de la agenda sin tocar ninguna regla.
 */

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Qué se puede HACER con cada ítem. Semántica, no ruta: cada superficie —web y móvil— la mapea a la
 * suya, y por eso acá no hay `href`.
 */
const AGENDA_ACTION: Record<string, AgendaItemDto['action']> = {
  vaccination_due: 'vaccinate',
  pregnancy_overdue: 'review_pregnancy',
  calving_soon: 'view_animal',
  withdrawal_active: 'view_animal',
  health_task_due: 'complete_task',
};

const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Solo `health` y `reproduction`: la agenda es el trabajo de CAMPO del día. Los ítems de sistema
 * —los de sincronización— viven en su propia pantalla; mezclarlos acá pondría un problema técnico
 * al lado de una vaca por parir.
 *
 * Ordena por vencimiento y, a igual fecha, por severidad: lo vencido primero, y dentro del mismo día
 * lo grave antes que lo informativo.
 */
export function toAgenda(desired: Desired[]): AgendaItemDto[] {
  return desired
    .filter((d) => d.category === 'health' || d.category === 'reproduction')
    .map((d) => ({
      code: d.code,
      category: d.category,
      severity: d.severity,
      due_at: iso(d.due_at),
      title: d.title,
      message: d.message,
      related_type: d.related_type,
      related_id: d.related_id,
      tag: d.tag ?? null,
      action: AGENDA_ACTION[d.code] ?? 'view_animal',
    }))
    .sort((a, b) => {
      const ad = a.due_at ?? '9999-12-31';
      const bd = b.due_at ?? '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    });
}
