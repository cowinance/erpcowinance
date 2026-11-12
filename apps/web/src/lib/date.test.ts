import { afterEach, describe, expect, it } from 'vitest';
import { addFarmDays, farmTimeZone, toFarmDate } from './date';

/**
 * El día de la FINCA en el navegador.
 *
 * Es la contraparte de lo que ya está probado en el dominio y en el móvil, y existe por el mismo
 * bug: usar la fecha de UTC hacía que en Venezuela (UTC−4), después de las 20:00, los selectores
 * propusieran el día siguiente y la agenda mostrara un «hoy» equivocado.
 *
 * Las zonas de prueba son EXTREMAS a propósito. Con Caracas el test solo demostraría algo entre
 * las 00 y las 04 UTC y pasaría vacío el resto del día, que es la peor clase de test.
 */

/** Simula el `data-farm-tz` que el layout pone en el `<html>`. */
function conZonaDeFinca(tz: string | null) {
  (globalThis as { document?: unknown }).document = {
    documentElement: { dataset: tz === null ? {} : { farmTz: tz } },
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

/** `YYYY-MM-DD` de una zona, calculado aparte del código bajo prueba. */
const hoyEn = (tz: string, d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

describe('farmTimeZone', () => {
  it('manda la zona de la finca que puso el layout', () => {
    conZonaDeFinca('America/Caracas');
    expect(farmTimeZone()).toBe('America/Caracas');
  });

  /** Para quien está parado en la finca es la misma; como respaldo es muchísimo mejor que UTC. */
  it('sin zona de finca cae a la del dispositivo, nunca a UTC a ciegas', () => {
    conZonaDeFinca(null);
    expect(farmTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('en el servidor, sin document, tampoco explota', () => {
    delete (globalThis as { document?: unknown }).document;
    expect(typeof farmTimeZone()).toBe('string');
  });
});

describe('toFarmDate', () => {
  it('AL MENOS UNA ZONA EXTREMA DIFIERE DE UTC AHORA MISMO', () => {
    // Es lo que hace que los tests de abajo signifiquen algo a cualquier hora del día.
    const utc = hoyEn('UTC');
    expect([hoyEn('Pacific/Kiritimati'), hoyEn('Pacific/Midway')].some((d) => d !== utc)).toBe(true);
  });

  for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway', 'America/Caracas']) {
    it(`devuelve el día de ${tz}, no el del dispositivo`, () => {
      conZonaDeFinca(tz);
      expect(toFarmDate()).toBe(hoyEn(tz));
    });
  }

  /** El caso real que originó todo: 20:30 en Venezuela es el día 26, no el 27. */
  it('un instante de la noche venezolana pertenece al día que termina, no al siguiente', () => {
    conZonaDeFinca('America/Caracas');
    expect(toFarmDate(new Date('2026-05-27T00:30:00Z'))).toBe('2026-05-26');
  });

  /** Una zona mal cargada no puede dejar una pantalla en blanco. */
  it('una zona inválida cae a la del dispositivo en vez de lanzar', () => {
    conZonaDeFinca('No/Existe');
    expect(() => toFarmDate()).not.toThrow();
    expect(toFarmDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addFarmDays', () => {
  it('suma y resta días de calendario', () => {
    expect(addFarmDays('2026-05-20', 1)).toBe('2026-05-21');
    expect(addFarmDays('2026-05-20', -1)).toBe('2026-05-19');
    expect(addFarmDays('2026-05-20', 0)).toBe('2026-05-20');
  });

  it('cruza fin de mes y fin de año', () => {
    expect(addFarmDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addFarmDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addFarmDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('conoce los años bisiestos', () => {
    expect(addFarmDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addFarmDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  /**
   * El motivo de operar sobre el calendario y no sumando milisegundos locales: el día en que
   * cambia el horario de verano dura 23 o 25 horas, y la cuenta se corre un día entero. Un retiro
   * de carne corrido hacia atrás es carne con residuos dada por habilitada.
   */
  it('no se corre en el cambio de horario de verano', () => {
    // EE.UU., marzo de 2026: el 8 dura 23 horas. Europa, octubre: el 25 dura 25.
    expect(addFarmDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addFarmDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addFarmDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addFarmDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('sumar muchos días cae donde tiene que caer', () => {
    // 283 días de gestación desde un servicio: la cuenta más usada del sistema.
    expect(addFarmDays('2026-01-01', 283)).toBe('2026-10-11');
    expect(addFarmDays('2026-05-20', 365)).toBe('2027-05-20');
  });
});
