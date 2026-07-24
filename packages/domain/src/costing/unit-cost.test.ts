import { describe, expect, it } from 'vitest';
import { computeUnitCost } from './unit-cost';

describe('computeUnitCost — costo por unidad producida', () => {
  it('divide el costo por lo producido', () => {
    expect(computeUnitCost({ totalCost: 1850, output: 100 }).unitCost).toBe(18.5);
  });

  it('redondea a dos decimales', () => {
    expect(computeUnitCost({ totalCost: 100, output: 3 }).unitCost).toBe(33.33);
  });

  it('sin producción devuelve null, NO cero (cero ordenaría como el más eficiente)', () => {
    expect(computeUnitCost({ totalCost: 5000, output: 0 }).unitCost).toBeNull();
  });

  it('producción negativa (el lote perdió peso) devuelve null', () => {
    expect(computeUnitCost({ totalCost: 5000, output: -40 }).unitCost).toBeNull();
  });

  it('costo cero es un dato válido: el unitario es 0', () => {
    expect(computeUnitCost({ totalCost: 0, output: 100 }).unitCost).toBe(0);
  });

  it('valores no numéricos no rompen: devuelven null', () => {
    expect(computeUnitCost({ totalCost: Number.NaN, output: 100 }).unitCost).toBeNull();
    expect(computeUnitCost({ totalCost: 100, output: Number.NaN }).unitCost).toBeNull();
    expect(computeUnitCost({ totalCost: 100, output: Number.POSITIVE_INFINITY }).unitCost).toBeNull();
  });

  it('el costo por hectárea solo aparece si se informó superficie', () => {
    expect(computeUnitCost({ totalCost: 900, output: 3000 }).costPerHa).toBeNull();
    expect(computeUnitCost({ totalCost: 900, output: 3000, areaHa: null }).costPerHa).toBeNull();
    expect(computeUnitCost({ totalCost: 900, output: 3000, areaHa: 0 }).costPerHa).toBeNull();
    expect(computeUnitCost({ totalCost: 900, output: 3000, areaHa: 3 }).costPerHa).toBe(300);
  });

  it('costo unitario y por hectárea son independientes: uno puede existir sin el otro', () => {
    // Cultivo con superficie pero todavía sin cosecha: se conoce el costo/ha, no el costo/kg.
    const r = computeUnitCost({ totalCost: 900, output: 0, areaHa: 3 });
    expect(r.unitCost).toBeNull();
    expect(r.costPerHa).toBe(300);
  });
});
