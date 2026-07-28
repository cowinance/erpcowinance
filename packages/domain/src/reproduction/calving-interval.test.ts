import { describe, expect, it } from 'vitest';
import { MIN_CALVING_INTERVAL_DAYS, calvingIntervalIssue, impossibleCalvingIntervals } from './calving-interval';

describe('dos partos no pueden estar más cerca que una gestación', () => {
  it('EL PISO ES LA GESTACIÓN, NO UN NÚMERO APARTE', () => {
    // Si mañana se parametriza por especie, el piso la sigue solo.
    expect(MIN_CALVING_INTERVAL_DAYS).toBe(283);
  });

  it('SEIS PARTOS EN TRES AÑOS SE DETECTAN', () => {
    // El caso que destapó la auditoría: la vaca daba «479 kg destetados por año», casi el doble de
    // lo que produce una de verdad, y el número no chillaba — se veía como una vaca excelente.
    const seisEnTresAnios = ['2024-03-01', '2024-09-01', '2025-03-01', '2025-09-01', '2026-03-01', '2026-09-01'];
    expect(impossibleCalvingIntervals(seisEnTresAnios)).toHaveLength(5);
  });

  it('un historial normal no marca nada', () => {
    // Un parto por año es lo esperable: la regla tiene que callarse ahí o se vuelve ruido.
    expect(impossibleCalvingIntervals(['2024-03-01', '2025-03-01', '2026-03-01'])).toEqual([]);
  });

  it('acepta un parto separado por una gestación exacta', () => {
    // El borde: 283 días es posible, aunque apretado. Rechazarlo sería inventar un límite de manejo.
    expect(calvingIntervalIssue('2026-01-01', ['2025-03-24'])).toBeNull(); // 283 días
    expect(calvingIntervalIssue('2026-01-01', ['2025-03-25'])).not.toBeNull(); // 282
  });

  it('DOS PARTOS EL MISMO DÍA SUGIEREN MELLIZOS, que es lo que suele ser', () => {
    // El mensaje nombra la causa más probable: es la que más veces acierta y la que el productor
    // puede corregir solo.
    const r = calvingIntervalIssue('2026-05-10', ['2026-05-10']);
    expect(r!.days).toBe(0);
    expect(r!.message).toContain('mellizos');
    expect(r!.message).toContain('MISMO parto');
  });

  it('mira TODAS las fechas, no solo la anterior', () => {
    // Una carga histórica entra desordenada: un parto con fecha vieja choca igual contra el que le
    // sigue, y revisar solo el último lo dejaría pasar.
    const r = calvingIntervalIssue('2025-06-01', ['2024-01-01', '2025-07-01']);
    expect(r).not.toBeNull();
    expect(r!.conflictsWith).toBe('2025-07-01');
  });

  it('devuelve el conflicto MÁS cercano cuando hay varios', () => {
    const r = calvingIntervalIssue('2026-01-01', ['2025-11-01', '2025-12-20']);
    expect(r!.conflictsWith).toBe('2025-12-20');
  });

  it('sin historial no hay conflicto posible', () => {
    expect(calvingIntervalIssue('2026-01-01', [])).toBeNull();
  });

  it('una fecha basura no rompe la regla', () => {
    // El dato viene de una planilla: no puede tumbar la pantalla de captura.
    expect(() => calvingIntervalIssue('no-es-fecha', ['2026-01-01'])).not.toThrow();
    expect(() => impossibleCalvingIntervals(['', 'xx'])).not.toThrow();
  });
});
