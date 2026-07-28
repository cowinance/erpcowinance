import { describe, it, expect } from 'vitest';
import { computeWithdrawal } from './withdrawal';

/**
 * Misma tabla de valores que el oráculo golden (F0):
 * apps/api/test/business-rules.golden.test.ts + docs/golden/business-rules.md.
 * Prueba de no-cambio: la función extraída reproduce exactamente el
 * comportamiento que tenía health.service.ts/SyncContext.tsx.
 */
describe('computeWithdrawal · retiro de carne', () => {
  it.each([
    ['2026-07-01T10:00:00.000Z', 35, '2026-08-05'],
    ['2026-07-01T10:00:00.000Z', 28, '2026-07-29'],
    ['2026-02-15T00:00:00.000Z', 35, '2026-03-22'], // cruza fin de febrero (2026 no bisiesto)
  ])('aplicado %s + %i días → %s', (applied, days, expected) => {
    expect(computeWithdrawal(new Date(applied), days, null).meatWithdrawalUntil).toBe(expected);
  });

  it('0 días o null → sin retiro', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), 0, null).meatWithdrawalUntil).toBeNull();
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, null).meatWithdrawalUntil).toBeNull();
  });

  it('propiedad: el retiro cae exactamente N días después de la fecha de aplicación', () => {
    const applied = new Date('2026-09-10T14:30:00.000Z');
    for (const days of [1, 7, 35, 120]) {
      const until = computeWithdrawal(applied, days, null).meatWithdrawalUntil!;
      const diff = (Date.parse(`${until}T00:00:00.000Z`) - Date.parse('2026-09-10T00:00:00.000Z')) / 86400000;
      expect(diff).toBe(days);
    }
  });
});

describe('computeWithdrawal · retiro de leche', () => {
  it('96 h después conserva la hora del día (timestamp completo)', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, 96).milkWithdrawalUntil).toBe(
      '2026-07-05T10:00:00.000Z',
    );
  });

  it('0 horas o null → sin retiro', () => {
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, 0).milkWithdrawalUntil).toBeNull();
    expect(computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), null, null).milkWithdrawalUntil).toBeNull();
  });
});

describe('computeWithdrawal · ambos a la vez (uso real: un producto define ambos)', () => {
  it('calcula carne y leche independientemente en la misma llamada', () => {
    const result = computeWithdrawal(new Date('2026-07-01T10:00:00.000Z'), 35, 96);
    expect(result.meatWithdrawalUntil).toBe('2026-08-05');
    expect(result.milkWithdrawalUntil).toBe('2026-07-05T10:00:00.000Z');
  });
});

describe('el retiro de carne se cuenta en el calendario de la FINCA', () => {
  it('UN TRATAMIENTO DE LAS 20:30 NO CUENTA DESDE MAÑANA', () => {
    // En Venezuela (UTC−4) las 20:30 ya son «mañana» en Greenwich. Contando en UTC, el retiro
    // terminaba un día tarde: molesto, pero del lado seguro.
    const atardecer = new Date('2026-07-20T20:30:00-04:00');
    expect(computeWithdrawal(atardecer, 28, null, 'America/Caracas').meatWithdrawalUntil).toBe('2026-08-17');
    expect(computeWithdrawal(atardecer, 28, null).meatWithdrawalUntil).toBe('2026-08-18'); // lo que hacía antes
  });

  it('DEL OTRO LADO DEL MERIDIANO EL ERROR ERA PELIGROSO', () => {
    // En UTC+9 un tratamiento de las 08:00 todavía es «ayer» en UTC, así que el retiro terminaba un
    // día ANTES de lo debido: carne con residuos habilitada para vender.
    const manana = new Date('2026-07-20T08:00:00+09:00');
    expect(computeWithdrawal(manana, 28, null, 'Asia/Tokyo').meatWithdrawalUntil).toBe('2026-08-17');
    expect(computeWithdrawal(manana, 28, null).meatWithdrawalUntil).toBe('2026-08-16'); // un día ANTES
  });

  it('EL RETIRO DE LECHE NO CAMBIA: se cuenta en horas', () => {
    // Un instante más horas es un instante. Ahí no hay calendario que interpretar, y meterle una
    // zona sería inventar un problema.
    const t = new Date('2026-07-20T20:30:00-04:00');
    expect(computeWithdrawal(t, null, 96, 'America/Caracas').milkWithdrawalUntil).toBe(
      computeWithdrawal(t, null, 96, 'Asia/Tokyo').milkWithdrawalUntil,
    );
  });

  it('sin retiro declarado no inventa una fecha', () => {
    expect(computeWithdrawal(new Date(), 0, 0, 'America/Caracas')).toEqual({ meatWithdrawalUntil: null, milkWithdrawalUntil: null });
    expect(computeWithdrawal(new Date(), null, null, 'America/Caracas')).toEqual({ meatWithdrawalUntil: null, milkWithdrawalUntil: null });
  });

  it('cruza fin de mes sin corrimiento', () => {
    expect(computeWithdrawal(new Date('2026-01-20T10:00:00-04:00'), 45, null, 'America/Caracas').meatWithdrawalUntil).toBe('2026-03-06');
  });
});

describe('una fecha calendario no tiene zona horaria', () => {
  it('UNA FECHA PELADA NO RETROCEDE UN DÍA', () => {
    // Es lo que manda el formulario: «2026-06-01», sin hora. Pasarla por una zona la leería como
    // medianoche UTC y en América la correría al 31 de mayo, arrancando el retiro un día antes.
    expect(computeWithdrawal('2026-06-01', 28, null, 'America/Caracas').meatWithdrawalUntil).toBe('2026-06-29');
    expect(computeWithdrawal('2026-06-01', 28, null, 'Asia/Tokyo').meatWithdrawalUntil).toBe('2026-06-29');
  });

  it('un INSTANTE sí se convierte: ése depende de dónde se lo mire', () => {
    // Medianoche UTC del 1 de junio son las 20:00 del 31 de mayo en Caracas.
    expect(computeWithdrawal(new Date('2026-06-01T00:00:00Z'), 28, null, 'America/Caracas').meatWithdrawalUntil).toBe('2026-06-28');
  });
});
