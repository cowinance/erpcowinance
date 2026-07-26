import { describe, expect, it } from 'vitest';
import { assessSaleCertifications, type CertificationCoverage } from './sale-certifications';

const VENTA = '2026-06-15';
const cobertura = (o: Partial<CertificationCoverage> & { animalId: string }): CertificationCoverage => ({
  scheme: 'Orgánico',
  scope: 'farm',
  status: 'active',
  validUntil: '2027-01-01',
  ...o,
});

const check = (animalIds: string[], coverage: CertificationCoverage[], schemes = ['Orgánico']) =>
  assessSaleCertifications({ saleDate: VENTA, animalIds, schemes, coverage });

describe('la venta avisa antes de cerrarse', () => {
  it('con todos los animales cubiertos y vigente, no molesta', () => {
    // Un aviso que aparece siempre se cierra sin leer.
    const r = check(['a', 'b'], [cobertura({ animalId: 'a' }), cobertura({ animalId: 'b' })]);
    expect(r.hasWarnings).toBe(false);
    expect(r.schemes[0].verdict).toBe('ok');
  });

  it('LA CERTIFICACIÓN VENCIDA SE AVISA ANTES, NO EN EL CONTROL', () => {
    // Es la razón de ser de la etapa: el dato estaba cargado hace meses y aparecía con el camión ya
    // cargado.
    const r = check(['a'], [cobertura({ animalId: 'a', validUntil: '2026-05-01' })]);
    expect(r.schemes[0].verdict).toBe('vencida');
    expect(r.hasWarnings).toBe(true);
  });

  it('distingue vencida de suspendida de nunca tuvo: se resuelven en lugares distintos', () => {
    // Decir siempre «falta la certificación» mandaría al productor a buscar donde no es.
    expect(check(['a'], [cobertura({ animalId: 'a', validUntil: '2026-01-01' })]).schemes[0].verdict).toBe('vencida');
    expect(check(['a'], [cobertura({ animalId: 'a', status: 'revoked' })]).schemes[0].verdict).toBe('suspendida');
    expect(check(['a'], []).schemes[0].verdict).toBe('sin_cobertura');
  });

  it('la venta MIXTA se nombra como tal', () => {
    const r = check(['a', 'b', 'c'], [cobertura({ animalId: 'a' })]);
    expect(r.schemes[0].verdict).toBe('parcial');
    expect(r.schemes[0].coveredAnimals).toBe(1);
    expect(r.schemes[0].uncoveredAnimalIds).toEqual(['b', 'c']);
  });

  it('avisa si vence entre la venta y la entrega', () => {
    const r = check(['a'], [cobertura({ animalId: 'a', validUntil: '2026-06-30' })]);
    expect(r.schemes[0].verdict).toBe('por_vencer');
    expect(r.schemes[0].message).toContain('2026-06-30');
  });

  it('la ventana de aviso es configurable, no una constante escondida', () => {
    const corta = assessSaleCertifications({
      saleDate: VENTA,
      animalIds: ['a'],
      schemes: ['Orgánico'],
      coverage: [cobertura({ animalId: 'a', validUntil: '2026-06-30' })],
      expiringWithinDays: 5,
    });
    expect(corta.schemes[0].verdict).toBe('ok'); // vence en 15 días, la ventana es de 5
  });
});

describe('la mejor cobertura gana', () => {
  it('la certificación de la finca ampara aunque la del animal esté vencida', () => {
    // Basta con que UNA lo cubra. Avisar por la peor de dos sería un aviso falso.
    const r = check(['a'], [
      cobertura({ animalId: 'a', scope: 'animal', validUntil: '2026-01-01' }),
      cobertura({ animalId: 'a', scope: 'farm', validUntil: '2027-06-01' }),
    ]);
    expect(r.schemes[0].verdict).toBe('ok');
  });

  it('sin fecha de vencimiento cargada se considera vigente, y no se inventa una', () => {
    const r = check(['a'], [cobertura({ animalId: 'a', validUntil: null })]);
    expect(r.schemes[0].verdict).toBe('ok');
    expect(r.schemes[0].earliestValidUntil).toBeNull();
  });

  it('el vencimiento informado es el MÁS PRÓXIMO de los que amparan', () => {
    const r = check(['a', 'b'], [
      cobertura({ animalId: 'a', validUntil: '2027-12-01' }),
      cobertura({ animalId: 'b', validUntil: '2026-11-01' }),
    ]);
    expect(r.schemes[0].earliestValidUntil).toBe('2026-11-01');
  });
});

describe('lo que la regla NO afirma', () => {
  it('NO INVENTA UNA OBLIGACIÓN: solo contrasta contra lo que la finca mantiene', () => {
    // El sistema no sabe qué pide el comprador. Sin esquemas cargados no hay nada que avisar, y
    // afirmar que falta algo sería una obligación inventada.
    const r = assessSaleCertifications({ saleDate: VENTA, animalIds: ['a'], schemes: [], coverage: [] });
    expect(r.schemes).toEqual([]);
    expect(r.hasWarnings).toBe(false);
  });

  it('el texto encuadra el aviso como revisión, no como impedimento', () => {
    const r = check(['a'], []);
    expect(r.schemes[0].message).toMatch(/depende de qué pida el comprador/i);
  });

  it('nunca devuelve algo que se lea como bloqueo', () => {
    // El contrato entero: avisa. Una venta a un comprador que no pide nada tiene que poder cerrarse.
    const r = check(['a'], [cobertura({ animalId: 'a', status: 'revoked' })]);
    expect(Object.keys(r)).toEqual(['hasWarnings', 'schemes']);
  });
});

describe('el orden lleva arriba lo que frena el camión', () => {
  it('lo vencido va antes que lo que está por vencer, y lo ok al final', () => {
    const r = assessSaleCertifications({
      saleDate: VENTA,
      animalIds: ['a'],
      schemes: ['AlDia', 'Vencido', 'PorVencer'],
      coverage: [
        cobertura({ animalId: 'a', scheme: 'AlDia', validUntil: '2028-01-01' }),
        cobertura({ animalId: 'a', scheme: 'Vencido', validUntil: '2026-01-01' }),
        cobertura({ animalId: 'a', scheme: 'PorVencer', validUntil: '2026-06-25' }),
      ],
    });
    expect(r.schemes.map((s) => s.scheme)).toEqual(['Vencido', 'PorVencer', 'AlDia']);
  });
});
