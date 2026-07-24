/**
 * Personalización del Inicio por ROL (Home E5, extraído en auditoría Fase 3 para poder testearlo).
 *
 * Regla: el rol NUNCA oculta información — solo reordena el ÉNFASIS. Los ítems de atención y las
 * acciones rápidas propias del rol suben al principio; el resto conserva su orden original (por
 * severidad→cantidad en el caso de la prioridad, que ya viene ordenada del backend).
 *
 * owner/admin (y cualquier rol no mapeado) → orden base, sin badge. Si mañana existe un rol de
 * reproducción, basta con sumarlo a ROLE_FOCUS.
 */
export interface RoleFocus {
  /** Etiqueta visible («Vista: Veterinario»). */
  label: string;
  /** Códigos de `priority` que este rol quiere ver primero. */
  codes: string[];
  /** Etiquetas de acciones rápidas priorizadas, en orden. */
  actions: string[];
}

export const ROLE_FOCUS: Record<string, RoleFocus> = {
  veterinarian: {
    label: 'Veterinario',
    codes: ['active_withdrawals', 'clinical_cases', 'vaccines_overdue', 'in_treatment', 'vaccines_due'],
    actions: ['Tratamiento', 'Vacuna', 'Modo manga'],
  },
  foreman: {
    label: 'Capataz',
    codes: ['tasks_overdue', 'tasks_urgent', 'no_recent_weighing'],
    actions: ['Modo manga', 'Nueva tarea', 'Mover'],
  },
  worker: {
    label: 'Operario',
    codes: ['tasks_overdue', 'tasks_urgent', 'no_recent_weighing'],
    actions: ['Modo manga', 'Nueva tarea'],
  },
};

/** Config del rol, o `undefined` para owner/admin/desconocido (orden base). */
export function focusFor(role?: string | null): RoleFocus | undefined {
  return role ? ROLE_FOCUS[role] : undefined;
}

/**
 * Reordena la atención prioritaria: los códigos del rol primero, el resto detrás. Estable → dentro
 * de cada grupo se conserva el orden que trajo el backend (severidad → cantidad). No filtra nada.
 */
export function orderPriorityByRole<T extends { code: string }>(items: T[], role?: string | null): T[] {
  const codes = new Set(focusFor(role)?.codes ?? []);
  if (codes.size === 0) return [...items];
  return [...items].sort((a, b) => (codes.has(a.code) ? 0 : 1) - (codes.has(b.code) ? 0 : 1));
}

/** Reordena las acciones rápidas: las del rol primero (en el orden declarado), el resto detrás. */
export function orderActionsByRole<T extends { label: string }>(items: T[], role?: string | null): T[] {
  const actions = focusFor(role)?.actions;
  if (!actions?.length) return [...items];
  const rank = (label: string) => {
    const i = actions.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...items].sort((a, b) => rank(a.label) - rank(b.label));
}
