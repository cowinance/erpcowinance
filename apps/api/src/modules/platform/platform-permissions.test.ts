import { describe, expect, it } from 'vitest';
import { MOTIVO_MIN, actionsFor, canPerform, validateReason } from './platform-permissions';
import type { PlatformRole } from './platform-session';

/**
 * Los cuatro roles no significaban nada en la fase 1 —todos leían lo mismo— y al aparecer las
 * escrituras pasan a separar responsabilidades. Este test fija esa separación: es lo que impide que
 * agregar una acción nueva al enum se la conceda a todos por descuido.
 */
describe('permisos de plataforma', () => {
  it('superadmin puede todo', () => {
    for (const a of actionsFor('superadmin')) expect(canPerform('superadmin', a)).toBe(true);
    expect(actionsFor('superadmin')).toHaveLength(6);
    expect(canPerform('superadmin', 'user.impersonate')).toBe(true);
  });

  it('billing decide lo COMERCIAL y no toca usuarios', () => {
    expect(canPerform('billing', 'organization.suspend')).toBe(true);
    expect(canPerform('billing', 'organization.change_plan')).toBe(true);
    // La mora es de la cuenta, no de la persona: bloquear gente no es asunto de facturación.
    expect(canPerform('billing', 'user.block')).toBe(false);
  });

  it('support actúa sobre PERSONAS y no decide plata', () => {
    expect(canPerform('support', 'user.block')).toBe(true);
    expect(canPerform('support', 'user.unblock')).toBe(true);
    expect(canPerform('support', 'organization.change_plan')).toBe(false);
    expect(canPerform('support', 'organization.suspend')).toBe(false);
  });

  it('auditor mira y no toca: ninguna acción', () => {
    expect(actionsFor('auditor')).toEqual([]);
    expect(canPerform('auditor', 'user.block')).toBe(false);
    expect(canPerform('auditor', 'organization.suspend')).toBe(false);
  });

  it('un rol desconocido no puede nada (fail-closed)', () => {
    expect(canPerform('inventado' as PlatformRole, 'user.block')).toBe(false);
    expect(actionsFor('inventado' as PlatformRole)).toEqual([]);
  });
});

/**
 * El motivo obligatorio ES la mitad del valor de la fase 2: una bitácora que dice «se suspendió la
 * cuenta X» no sirve tres meses después; la que dice por qué, sí.
 */
describe('motivo de la acción', () => {
  it('acepta una explicación de verdad y la recorta', () => {
    expect(validateReason('  falta de pago de la factura 1042  ')).toBe('falta de pago de la factura 1042');
  });

  it('rechaza vacío, espacios y el punto de trámite', () => {
    for (const malo of [undefined, null, '', '   ', '.', 'ok', 'porque si']) {
      expect(() => validateReason(malo)).toThrow(/obligatorio/);
    }
  });

  it('el mínimo existe para que el campo no sea opcional con pasos de más', () => {
    expect(() => validateReason('x'.repeat(MOTIVO_MIN - 1))).toThrow();
    expect(validateReason('x'.repeat(MOTIVO_MIN))).toHaveLength(MOTIVO_MIN);
  });

  it('pone techo, para que no entre un volcado entero en la bitácora', () => {
    expect(() => validateReason('x'.repeat(501))).toThrow(/500/);
  });
});
