import { describe, expect, it } from 'vitest';
import { computeUnitCost, costPerUnit } from './unit-cost';

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

describe('costPerUnit — un costo en cero no es un costo', () => {
  it('sin costo cargado el unitario es DESCONOCIDO, no cero', () => {
    // El caso real: el corral «Engorde Otoño» del demo ganó 1.490 kg sin una sola entrega de
    // alimento registrada, y la pantalla decía «$0 el kilo ganado». Un animal vivo no engorda
    // comiendo cero: lo que falta es el dato, no el alimento.
    expect(costPerUnit({ totalCost: 0, output: 1490 }).unitCost).toBeNull();
    expect(costPerUnit({ totalCost: 0, output: 1490, areaHa: 10 }).costPerHa).toBeNull();
  });

  it('el cero ordenaría PRIMERO justo al que no tiene los datos', () => {
    // Es la razón por la que importa, y la misma que ya estaba escrita para el divisor: un corral
    // con «$0 el kilo» encabeza cualquier comparación de eficiencia de la finca.
    const corrales = [
      { nombre: 'con datos', unit: costPerUnit({ totalCost: 50_000, output: 1000 }).unitCost },
      { nombre: 'sin cargar', unit: costPerUnit({ totalCost: 0, output: 1000 }).unitCost },
    ];
    const rankeables = corrales.filter((c) => c.unit != null);
    expect(rankeables.map((c) => c.nombre)).toEqual(['con datos']);
  });

  it('un costo REAL sigue dividiéndose igual', () => {
    expect(costPerUnit({ totalCost: 50_823, output: 10_253 }).unitCost).toBe(4.96);
  });

  it('NO se aplica al margen: cero es quedar hecho, y negativo es perder', () => {
    // `computeUnitCost` sigue siendo la división neutra a propósito. El margen por unidad la usa a
    // ella: ocultar un margen cero escondería justo la actividad que no deja nada, y ocultar uno
    // negativo escondería la que pierde plata — al revés de lo que sirve.
    expect(computeUnitCost({ totalCost: 0, output: 100 }).unitCost).toBe(0);
    expect(computeUnitCost({ totalCost: -5000, output: 100 }).unitCost).toBe(-50);
  });
});
