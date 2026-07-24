import { describe, expect, it } from 'vitest';
import { computeMargin } from './margin';

describe('computeMargin — margen y rentabilidad', () => {
  it('calcula margen, margen sobre ventas y retorno sobre lo invertido', () => {
    const r = computeMargin({ revenue: 1000, cost: 600 });
    expect(r.margin).toBe(400);
    expect(r.marginPct).toBe(40); // de cada $100 vendidos quedan $40
    expect(r.roiPct).toBe(66.67); // cada $100 gastado devolvió $66,67
  });

  it('el margen negativo se informa tal cual: perder plata es un hecho, no un error', () => {
    const r = computeMargin({ revenue: 500, cost: 800 });
    expect(r.margin).toBe(-300);
    expect(r.marginPct).toBe(-60);
    expect(r.roiPct).toBe(-37.5);
  });

  it('sin ingresos no hay margen sobre ventas (el lote está en pie, no fundido)', () => {
    const r = computeMargin({ revenue: 0, cost: 800 });
    expect(r.margin).toBe(-800);
    expect(r.marginPct).toBeNull(); // NO −100%: todavía no vendió
    expect(r.roiPct).toBe(-100); // sí perdió el 100% de lo invertido hasta ahora
  });

  it('sin costos no hay retorno calculable (no existe el retorno infinito)', () => {
    const r = computeMargin({ revenue: 1000, cost: 0 });
    expect(r.margin).toBe(1000);
    expect(r.marginPct).toBe(100);
    expect(r.roiPct).toBeNull(); // casi siempre significa que falta imputar el costo
  });

  it('sin ingresos ni costos devuelve margen 0 y ambos porcentajes en null', () => {
    expect(computeMargin({ revenue: 0, cost: 0 })).toEqual({ margin: 0, marginPct: null, roiPct: null });
  });

  it('valores no numéricos se tratan como 0 en vez de propagar NaN al reporte', () => {
    expect(computeMargin({ revenue: Number.NaN, cost: 100 }).margin).toBe(-100);
    expect(computeMargin({ revenue: 100, cost: Number.POSITIVE_INFINITY }).margin).toBe(100);
  });

  it('redondea a dos decimales', () => {
    expect(computeMargin({ revenue: 100, cost: 33.333 }).margin).toBe(66.67);
    expect(computeMargin({ revenue: 3, cost: 1 }).marginPct).toBe(66.67);
  });
});
