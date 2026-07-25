import { describe, it, expect } from 'vitest';
import { latestWithdrawal, mangaCardAlerts, type MangaCardInput } from './manga-alerts';

const HOY = new Date('2026-07-24T15:00:00Z');
const codes = (a: MangaCardInput) => mangaCardAlerts(a, HOY).map((x) => x.code);
/** Un animal sin nada que avisar: con lote y pesado hace poco. */
const sano: MangaCardInput = { lotId: 'lote-1', daysSinceWeighing: 10 };

describe('mangaCardAlerts', () => {
  it('un animal en orden no genera alertas', () => {
    expect(mangaCardAlerts(sano, HOY)).toEqual([]);
  });

  // La alerta que faltaba en el móvil: es la única con consecuencia regulatoria y de inocuidad.
  it('el retiro va primero, en rojo y SIN modo (no hay nada que capturar: hay que esperar)', () => {
    const [a] = mangaCardAlerts({ ...sano, meatWithdrawalUntil: '2026-08-10' }, HOY);
    expect(a).toMatchObject({ code: 'withdrawal', tone: 'danger' });
    expect(a.mode).toBeUndefined();
    expect(a.text).toContain('carne hasta 10/08');
  });

  it('distingue retiro de carne y de leche, y los muestra juntos', () => {
    const [a] = mangaCardAlerts(
      { ...sano, meatWithdrawalUntil: '2026-08-10', milkWithdrawalUntil: '2026-07-26' },
      HOY,
    );
    expect(a.text).toContain('carne hasta 10/08');
    expect(a.text).toContain('leche hasta 26/07');
  });

  it('un retiro vencido ya no avisa', () => {
    expect(codes({ ...sano, meatWithdrawalUntil: '2026-07-23' })).toEqual([]);
  });

  it('el retiro que termina HOY sigue vigente', () => {
    expect(codes({ ...sano, meatWithdrawalUntil: '2026-07-24' })).toEqual(['withdrawal']);
  });

  it('el caso clínico abierto manda a Tratamiento y marca la gravedad', () => {
    const [a] = mangaCardAlerts({ ...sano, openCases: 1, caseSeverity: 'severe' }, HOY);
    expect(a).toMatchObject({ code: 'open_case', tone: 'danger', mode: 'Tratamiento' });
    expect(a.text).toContain('grave');
  });

  // Avisar tres meses antes del parto es ruido; el operario deja de mirar las alertas.
  it('el parto avisa solo dentro de la ventana', () => {
    expect(codes({ ...sano, sex: 'F', expectedDueDate: '2026-08-10' })).toContain('calving_soon'); // 17 d
    expect(codes({ ...sano, sex: 'F', expectedDueDate: '2026-08-14' })).toContain('calving_soon'); // 21 d: el borde SÍ avisa
    expect(codes({ ...sano, sex: 'F', expectedDueDate: '2026-08-15' })).toEqual([]); // 22 d, ya no
    expect(codes({ ...sano, sex: 'F', expectedDueDate: '2026-07-16' })).toContain('calving_soon'); // −8, vencido
    expect(codes({ ...sano, sex: 'F', expectedDueDate: '2026-07-10' })).toEqual([]); // −14, ya no
  });

  it('un macho con fecha de parto cargada no avisa (dato viejo o error)', () => {
    expect(codes({ ...sano, sex: 'M', expectedDueDate: '2026-08-01' })).toEqual([]);
  });

  it('el parto vencido lo dice con todas las letras', () => {
    const [a] = mangaCardAlerts({ ...sano, sex: 'F', expectedDueDate: '2026-07-20' }, HOY);
    expect(a.text).toContain('vencido');
  });

  it('sin lote manda a Movimiento', () => {
    expect(mangaCardAlerts({ daysSinceWeighing: 5 }, HOY)[0]).toMatchObject({ code: 'no_lot', mode: 'Movimiento' });
  });

  // "Nunca se pesó" y "hace mucho" son cosas distintas y se dicen distinto.
  it('distingue nunca pesado de sin pesaje reciente', () => {
    expect(mangaCardAlerts({ lotId: 'l', daysSinceWeighing: null }, HOY)[0].text).toBe('SIN PESAJE · pesar');
    expect(mangaCardAlerts({ lotId: 'l', daysSinceWeighing: 120 }, HOY)[0].text).toBe('SIN PESAJE RECIENTE · pesar');
    expect(codes({ lotId: 'l', daysSinceWeighing: 90 })).toEqual([]); // el borde no alerta
  });

  it('ordena por gravedad: primero el retiro, después el caso, después el resto', () => {
    const r = codes({
      meatWithdrawalUntil: '2026-08-01',
      openCases: 2,
      sex: 'F',
      expectedDueDate: '2026-08-01',
      lotId: null,
      daysSinceWeighing: null,
    });
    expect(r).toEqual(['withdrawal', 'open_case', 'calving_soon']);
  });

  // Más de tres en una tarjeta de manga no se leen: se saltean todas.
  it('muestra como mucho tres', () => {
    expect(
      mangaCardAlerts(
        { meatWithdrawalUntil: '2026-08-01', openCases: 1, sex: 'F', expectedDueDate: '2026-08-01', lotId: null, daysSinceWeighing: null },
        HOY,
      ),
    ).toHaveLength(3);
  });

  it('todas las alertas accionables apuntan a un modo que existe', () => {
    const todas = mangaCardAlerts({ openCases: 1, lotId: null, daysSinceWeighing: null }, HOY);
    for (const a of todas) if (a.mode) expect(['Tratamiento', 'Movimiento', 'Pesaje', 'Reproducción']).toContain(a.mode);
  });
});

describe('latestWithdrawal', () => {
  // Un tratamiento aplicado recién en la manga extiende el retiro: quedarse con el dato del
  // servidor diría que el animal ya está apto cuando no lo está.
  it('gana la fecha más lejana', () => {
    expect(latestWithdrawal('2026-08-01', '2026-08-15')).toBe('2026-08-15');
    expect(latestWithdrawal('2026-08-15', '2026-08-01')).toBe('2026-08-15');
  });

  it('ignora lo ausente y lo inválido', () => {
    expect(latestWithdrawal(null, '2026-08-01', undefined)).toBe('2026-08-01');
    expect(latestWithdrawal('no es fecha', '2026-08-01')).toBe('2026-08-01');
  });

  it('sin ninguna fecha devuelve null', () => {
    expect(latestWithdrawal(null, undefined)).toBeNull();
    expect(latestWithdrawal()).toBeNull();
  });
});
