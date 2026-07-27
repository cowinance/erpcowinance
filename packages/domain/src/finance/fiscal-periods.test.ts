import { describe, expect, it } from 'vitest';
import { initialFiscalPeriods, monthlyPeriods } from './fiscal-periods';

describe('los períodos fiscales de una finca nueva', () => {
  it('son doce, uno por mes', () => {
    const p = monthlyPeriods(2026);
    expect(p).toHaveLength(12);
    expect(p[0].name).toBe('Enero 2026');
    expect(p[11].name).toBe('Diciembre 2026');
  });

  it('CADA MES TERMINA EL DÍA QUE TERMINA DE VERDAD', () => {
    // Un fin de mes mal calculado deja un día sin período: el asiento del 31 no encuentra dónde ir,
    // y es justo el día en que se cierra y se factura.
    const p = monthlyPeriods(2026);
    expect(p[0]).toMatchObject({ start_date: '2026-01-01', end_date: '2026-01-31' });
    expect(p[3]).toMatchObject({ start_date: '2026-04-01', end_date: '2026-04-30' });
    expect(p[11]).toMatchObject({ start_date: '2026-12-01', end_date: '2026-12-31' });
  });

  it('febrero sabe de años bisiestos', () => {
    expect(monthlyPeriods(2026)[1].end_date).toBe('2026-02-28');
    expect(monthlyPeriods(2028)[1].end_date).toBe('2028-02-29');
  });

  it('NO QUEDA NI UN DÍA DEL AÑO SIN PERÍODO', () => {
    // El invariante de verdad: los períodos cubren el año entero, sin huecos y sin solaparse. Un
    // hueco de un día solo se descubre el día que cae un asiento ahí.
    const p = monthlyPeriods(2026);
    expect(p[0].start_date).toBe('2026-01-01');
    expect(p[11].end_date).toBe('2026-12-31');
    for (let i = 1; i < p.length; i++) {
      const finAnterior = new Date(`${p[i - 1].end_date}T00:00:00Z`).getTime();
      const inicio = new Date(`${p[i].start_date}T00:00:00Z`).getTime();
      expect(inicio - finAnterior, `hueco o solape entre ${p[i - 1].name} y ${p[i].name}`).toBe(86_400_000);
    }
  });

  it('el alta incluye el año siguiente: el 1 de enero no puede romper la contabilidad', () => {
    // Con un solo año, el 1 de enero toda la contabilidad deja de asentar de golpe.
    const p = initialFiscalPeriods(2026);
    expect(p).toHaveLength(24);
    expect(p[0].start_date).toBe('2026-01-01');
    expect(p[23].end_date).toBe('2027-12-31');
  });

  it('los nombres no se repiten: llevan el año', () => {
    const p = initialFiscalPeriods(2026);
    expect(new Set(p.map((x) => x.name)).size).toBe(24);
  });
});
