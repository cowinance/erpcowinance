import { describe, it, expect } from 'vitest';
import { contractStanding, isCurrent, summarizeContracts, type ContractLike } from './contracts';

const HOY = '2026-07-24';
const c = (over: Partial<ContractLike> = {}): ContractLike => ({
  status: 'active',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  ...over,
});

describe('contractStanding', () => {
  it('vigente cuando el fin está lejos', () => {
    expect(contractStanding(c(), HOY)).toBe('active');
  });

  it('sin fecha de fin es un contrato abierto: no vence', () => {
    expect(contractStanding(c({ end_date: null }), HOY)).toBe('active');
  });

  it('por vencer dentro de la ventana de aviso', () => {
    expect(contractStanding(c({ end_date: '2026-08-10' }), HOY)).toBe('expiring_soon'); // 17 días
    expect(contractStanding(c({ end_date: '2026-08-23' }), HOY)).toBe('expiring_soon'); // 30, el borde
    expect(contractStanding(c({ end_date: '2026-08-24' }), HOY)).toBe('active'); // 31
  });

  it('la ventana de aviso es configurable', () => {
    expect(contractStanding(c({ end_date: '2026-09-15' }), HOY, 60)).toBe('expiring_soon');
  });

  it('vencido cuando el fin ya pasó', () => {
    expect(contractStanding(c({ end_date: '2026-07-23' }), HOY)).toBe('expired');
  });

  it('todavía no empezó', () => {
    expect(contractStanding(c({ start_date: '2026-09-01' }), HOY)).toBe('upcoming');
  });

  // Rescindir es una decisión; vencer es el paso del tiempo. La decisión gana.
  it('rescindido y borrador ganan sobre el cálculo de fechas', () => {
    expect(contractStanding(c({ status: 'terminated' }), HOY)).toBe('terminated');
    expect(contractStanding(c({ status: 'terminated', end_date: '2030-01-01' }), HOY)).toBe('terminated');
    expect(contractStanding(c({ status: 'draft' }), HOY)).toBe('draft');
  });

  it('cuenta como vigente lo activo y lo que está por vencer', () => {
    expect(isCurrent('active')).toBe(true);
    expect(isCurrent('expiring_soon')).toBe(true); // sigue en vigencia: todavía no venció
    expect(isCurrent('expired')).toBe(false);
    expect(isCurrent('upcoming')).toBe(false);
  });
});

describe('summarizeContracts', () => {
  it('cuenta por situación y suma el valor de los vigentes', () => {
    const r = summarizeContracts(
      [
        c({ value: 100000 }),
        c({ end_date: '2026-08-05', value: 50000 }), // por vencer
        c({ end_date: '2026-01-31', value: 999 }), // vencido: no cuenta
        c({ status: 'draft', value: 777 }), // borrador: no cuenta
      ],
      HOY,
    );
    expect(r).toMatchObject({ active: 1, expiringSoon: 1, expired: 1, currentValue: 150000 });
  });

  it('los vigentes sin valor no suman como cero y se informan', () => {
    const r = summarizeContracts([c({ value: 1000 }), c({ value: null })], HOY);
    expect(r.currentValue).toBe(1000);
    expect(r.currentWithoutValue).toBe(1);
  });

  it('si ninguno tiene valor, la cartera es null', () => {
    const r = summarizeContracts([c({ value: null })], HOY);
    expect(r.currentValue).toBeNull();
    expect(r.currentWithoutValue).toBe(1);
  });

  it('sin contratos no rompe', () => {
    expect(summarizeContracts([], HOY)).toEqual({
      active: 0,
      expiringSoon: 0,
      expired: 0,
      currentValue: null,
      currentWithoutValue: 0,
    });
  });
});
