import { describe, it, expect } from 'vitest';
import { addCalendarDays, formatCalendarEs, buildProtocolCalendar, type CalendarProtocol } from './protocol-calendar';

describe('addCalendarDays', () => {
  it('caso 1: día 0 devuelve la misma fecha', () => {
    expect(addCalendarDays('2027-05-01', 0)).toBe('2027-05-01');
  });
  it('caso 2: suma de varios días', () => {
    expect(addCalendarDays('2027-05-01', 8)).toBe('2027-05-09');
    expect(addCalendarDays('2027-05-01', 10)).toBe('2027-05-11');
  });
  it('caso 3: cambio de mes', () => {
    expect(addCalendarDays('2027-01-28', 5)).toBe('2027-02-02');
  });
  it('caso 4: cambio de año', () => {
    expect(addCalendarDays('2027-12-30', 3)).toBe('2028-01-02');
  });
  it('caso 5: fecha inválida → null', () => {
    expect(addCalendarDays('2027-02-30', 0)).toBeNull();
    expect(addCalendarDays('no-fecha', 1)).toBeNull();
    expect(addCalendarDays('2027-05-01', 1.5)).toBeNull();
  });
  it('caso 6: sin desplazamiento por timezone (aritmética y formato en UTC)', () => {
    // 1 de enero a medianoche NO debe caer al 31 de diciembre por zona negativa.
    expect(addCalendarDays('2027-01-01', 0)).toBe('2027-01-01');
    expect(formatCalendarEs('2027-01-01')).toMatch(/1.*ene.*2027/);
  });
});

describe('buildProtocolCalendar', () => {
  const protos = new Map<string, CalendarProtocol>([
    ['p1', { id: 'p1', name: 'IATF', steps: [{ day: 0, action: 'Implante' }, { day: 8, action: 'Retiro' }, { day: 10, action: 'IATF' }] }],
  ]);
  const today = '2027-05-01';

  it('proyecta pasos ≥ hoy de asignaciones activas, ordenados por fecha', () => {
    const cal = buildProtocolCalendar(
      [{ id: 'a1', protocol_id: 'p1', protocol_name: 'IATF', lot_name: 'Recría', start_date: '2027-05-01', status: 'active' }],
      protos,
      today,
    );
    expect(cal.map((i) => i.date)).toEqual(['2027-05-01', '2027-05-09', '2027-05-11']);
    expect(cal[0].action).toBe('Implante');
    expect(cal[0].lot).toBe('Recría');
  });

  it('excluye pasos pasados y asignaciones no activas', () => {
    const cal = buildProtocolCalendar(
      [
        { id: 'a1', protocol_id: 'p1', protocol_name: 'IATF', lot_name: 'L', start_date: '2027-04-25', status: 'active' }, // día 0 = 04-25 (pasado), día 8 = 05-03 (futuro)
        { id: 'a2', protocol_id: 'p1', protocol_name: 'IATF', lot_name: 'L', start_date: '2027-05-01', status: 'canceled' }, // cancelada → nada
      ],
      protos,
      today,
    );
    expect(cal.map((i) => i.date)).toEqual(['2027-05-03', '2027-05-05']); // 04-25+8 y 04-25+10
    expect(cal.every((i) => i.assignment_id === 'a1')).toBe(true);
  });

  it('protocolo no disponible en el catálogo → no aporta pasos (no rompe)', () => {
    const cal = buildProtocolCalendar([{ id: 'a1', protocol_id: 'zzz', lot_name: 'L', start_date: '2027-05-01', status: 'active' }], protos, today);
    expect(cal).toEqual([]);
  });

  it('orden: fecha asc, luego lote', () => {
    const cal = buildProtocolCalendar(
      [
        { id: 'a1', protocol_id: 'p1', lot_name: 'Zulu', start_date: '2027-05-01', status: 'active' },
        { id: 'a2', protocol_id: 'p1', lot_name: 'Alfa', start_date: '2027-05-01', status: 'active' },
      ],
      new Map([['p1', { id: 'p1', name: 'IATF', steps: [{ day: 0, action: 'Implante' }] }]]),
      today,
    );
    // misma fecha (05-01) → desempata por lote (Alfa antes que Zulu).
    expect(cal.map((i) => i.lot)).toEqual(['Alfa', 'Zulu']);
  });
});
