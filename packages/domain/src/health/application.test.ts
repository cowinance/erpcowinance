import { describe, expect, it } from 'vitest';
import { assertNotBeforeBirth, HealthApplicationError } from './application';

describe('un hecho del animal no puede ser anterior a su nacimiento', () => {
  const NACIO = '2025-12-08';

  it('rechaza un hecho de antes de que el animal existiera', () => {
    // Se aceptaba: un tratamiento fechado en 1990 sobre un animal nacido en 2025 entraba sin queja.
    // El retiro derivado no hace daño —venció hace décadas— pero el hecho queda en el historial y en
    // los reportes por período, que cuentan tratamientos, costo y consumo por mes.
    expect(() => assertNotBeforeBirth('1990-01-01', NACIO, 'La fecha de aplicación')).toThrow(HealthApplicationError);
  });

  it('EL DÍA DEL NACIMIENTO SÍ VALE', () => {
    // Es el borde que importa: a un ternero se lo trata el día que nace más seguido que cualquier
    // otro día de su vida. Una guarda con el signo mal puesta le cerraría la puerta justo ahí.
    expect(() => assertNotBeforeBirth(NACIO, NACIO, 'La fecha de aplicación')).not.toThrow();
  });

  it('el día siguiente también, obviamente', () => {
    expect(() => assertNotBeforeBirth('2025-12-09', NACIO, 'La fecha de aplicación')).not.toThrow();
  });

  it('sin fecha de nacimiento NO se valida nada', () => {
    // Un animal comprado sin ese dato es normal. Rechazar sus tratamientos por algo que nadie sabe
    // sería peor que el problema que esta regla resuelve.
    expect(() => assertNotBeforeBirth('1990-01-01', null, 'x')).not.toThrow();
    expect(() => assertNotBeforeBirth('1990-01-01', undefined, 'x')).not.toThrow();
  });

  it('el mensaje dice las DOS fechas, que es lo que hace falta para corregir', () => {
    try {
      assertNotBeforeBirth('1990-01-01', NACIO, 'La fecha de aplicación');
      throw new Error('debería haber fallado');
    } catch (e) {
      expect(e).toBeInstanceOf(HealthApplicationError);
      const err = e as HealthApplicationError;
      expect(err.code).toBe('health.before_birth');
      expect(err.reason).toContain('1990-01-01');
      expect(err.reason).toContain(NACIO);
    }
  });

  it('compara CALENDARIO, no instantes: un timestamp del día del nacimiento no se cae', () => {
    // Las dos son fechas, no momentos. Si esto convirtiera a `Date` para comparar, una fecha pelada
    // se volvería medianoche UTC y en América caería el día anterior — el error que ya costó caro en
    // el retiro y en el destete, y que volvió a aparecer al conectar esta regla al servicio.
    expect(() => assertNotBeforeBirth('2025-12-08T23:30:00-04:00', NACIO, 'x')).not.toThrow();
  });

  it('una fecha con formato raro no rompe ni bloquea', () => {
    // Validar el formato es de otro, y trabarse acá dejaría al productor sin poder cargar por un
    // motivo que este mensaje no sabría explicar.
    expect(() => assertNotBeforeBirth('ayer', NACIO, 'x')).not.toThrow();
    expect(() => assertNotBeforeBirth('1990-01-01', 'cualquier cosa', 'x')).not.toThrow();
  });
});
