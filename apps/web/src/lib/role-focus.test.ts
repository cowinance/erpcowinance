import { describe, expect, it } from 'vitest';
import { focusFor, orderActionsByRole, orderPriorityByRole } from './role-focus';

/**
 * Auditoría Fase 3 — verificación de la personalización por rol del Inicio, que había quedado
 * SIN verificar (el seed solo asigna `owner`, así que no se podía ejercitar por e2e). Al extraer
 * la regla a un helper puro se puede probar de verdad: el rol reordena el énfasis y NUNCA oculta.
 */
describe('Inicio · personalización por rol', () => {
  // Prioridad como la entrega el backend: ya ordenada por severidad → cantidad.
  const priority = [
    { code: 'tasks_overdue', severity: 'critical' },
    { code: 'critical_alerts', severity: 'critical' },
    { code: 'active_withdrawals', severity: 'warning' },
    { code: 'clinical_cases', severity: 'warning' },
    { code: 'calvings_soon', severity: 'info' },
  ];
  const actions = [
    { label: 'Modo manga' },
    { label: 'Crear animal' },
    { label: 'Nueva tarea' },
    { label: 'Tratamiento' },
    { label: 'Vacuna' },
    { label: 'Mover' },
  ];

  it('owner/admin (y rol desconocido) conservan el orden base y no tienen etiqueta', () => {
    for (const role of ['owner', 'admin', 'accountant', undefined, null]) {
      expect(focusFor(role)).toBeUndefined();
      expect(orderPriorityByRole(priority, role).map((p) => p.code)).toEqual(priority.map((p) => p.code));
      expect(orderActionsByRole(actions, role).map((a) => a.label)).toEqual(actions.map((a) => a.label));
    }
  });

  it('veterinario: sanidad primero, conservando severidad dentro del grupo', () => {
    expect(focusFor('veterinarian')?.label).toBe('Veterinario');
    const ordered = orderPriorityByRole(priority, 'veterinarian').map((p) => p.code);
    // Los de sanidad suben; entre ellos mantienen el orden original (withdrawals antes que cases).
    expect(ordered.slice(0, 2)).toEqual(['active_withdrawals', 'clinical_cases']);
    // El resto queda detrás, también en su orden original.
    expect(ordered.slice(2)).toEqual(['tasks_overdue', 'critical_alerts', 'calvings_soon']);
  });

  it('capataz: campo primero (tareas vencidas / sin pesaje)', () => {
    const ordered = orderPriorityByRole(priority, 'foreman').map((p) => p.code);
    expect(ordered[0]).toBe('tasks_overdue');
    expect(ordered.slice(1)).toEqual(['critical_alerts', 'active_withdrawals', 'clinical_cases', 'calvings_soon']);
  });

  it('NUNCA oculta: reordenar preserva todos los ítems', () => {
    for (const role of ['veterinarian', 'foreman', 'worker', 'owner']) {
      const ordered = orderPriorityByRole(priority, role);
      expect(ordered).toHaveLength(priority.length);
      expect([...ordered].map((p) => p.code).sort()).toEqual([...priority].map((p) => p.code).sort());
    }
  });

  it('acciones rápidas: las del rol primero, en el orden declarado', () => {
    expect(orderActionsByRole(actions, 'veterinarian').map((a) => a.label).slice(0, 3)).toEqual([
      'Tratamiento',
      'Vacuna',
      'Modo manga',
    ]);
    expect(orderActionsByRole(actions, 'foreman').map((a) => a.label).slice(0, 3)).toEqual([
      'Modo manga',
      'Nueva tarea',
      'Mover',
    ]);
    // El resto conserva su orden relativo y no se pierde ninguna.
    expect(orderActionsByRole(actions, 'foreman')).toHaveLength(actions.length);
  });

  it('no muta el arreglo original', () => {
    const before = priority.map((p) => p.code);
    orderPriorityByRole(priority, 'veterinarian');
    expect(priority.map((p) => p.code)).toEqual(before);
  });
});
