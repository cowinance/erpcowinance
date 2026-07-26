import { describe, expect, it } from 'vitest';
import { addFarmDays, asFarmDate, farmToday, isValidTimeZone, safeTimeZone, toFarmDate, FALLBACK_TIME_ZONE } from './farm-date';

const CARACAS = 'America/Caracas'; // UTC−4, sin horario de verano

describe('el día de la finca, no el de Greenwich', () => {
  it('EL TRATAMIENTO DE LAS 20:30 ES DEL 26, NO DEL 27', () => {
    // El bug que esta regla existe para matar: encerrar un rodeo al atardecer es lo normal, y todo
    // lo cargado después de las 20:00 se fechaba al día siguiente.
    const atardecer = new Date('2026-07-26T20:30:00-04:00');
    expect(atardecer.toISOString().slice(0, 10)).toBe('2026-07-27'); // lo que hacía la app
    expect(toFarmDate(atardecer, CARACAS)).toBe('2026-07-26'); // lo que ve el productor
  });

  it('a las 23:59 del último día del mes, la venta sigue siendo de ese mes', () => {
    // Con UTC caía en el mes siguiente y desaparecía del cierre.
    const finDeMes = new Date('2026-07-31T23:59:00-04:00');
    expect(toFarmDate(finDeMes, CARACAS)).toBe('2026-07-31');
  });

  it('de madrugada NO se adelanta: la medianoche de la finca es la medianoche de la finca', () => {
    expect(toFarmDate(new Date('2026-07-27T00:05:00-04:00'), CARACAS)).toBe('2026-07-27');
  });

  it('antes de las 20:00 coincide con UTC, que es por qué el bug pasaba desapercibido', () => {
    const mediodia = new Date('2026-07-26T12:00:00-04:00');
    expect(toFarmDate(mediodia, CARACAS)).toBe(mediodia.toISOString().slice(0, 10));
  });

  it('funciona al otro lado del meridiano', () => {
    // Zonas positivas fallan al revés: la madrugada local todavía es ayer en UTC.
    const tokio = new Date('2026-07-27T07:00:00+09:00');
    expect(tokio.toISOString().slice(0, 10)).toBe('2026-07-26');
    expect(toFarmDate(tokio, 'Asia/Tokyo')).toBe('2026-07-27');
  });

  it('farmToday acepta un ahora inyectado, para que los tests no dependan del reloj', () => {
    expect(farmToday(CARACAS, new Date('2026-07-26T20:30:00-04:00'))).toBe('2026-07-26');
  });
});

describe('una zona mal cargada no puede tumbar la app', () => {
  it('reconoce las zonas válidas y rechaza las inventadas', () => {
    expect(isValidTimeZone(CARACAS)).toBe(true);
    expect(isValidTimeZone('America/Nowhere')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it('cae a UTC en vez de lanzar', () => {
    // El valor viaja a un set_config de PostgreSQL y a un Intl: una cadena inventada rompería los
    // dos, y a las 20:00 es el peor momento para descubrirlo.
    expect(safeTimeZone('America/Nowhere')).toBe(FALLBACK_TIME_ZONE);
    expect(safeTimeZone(undefined)).toBe(FALLBACK_TIME_ZONE);
    expect(() => toFarmDate(new Date(), 'basura')).not.toThrow();
  });
});

describe('sumar días sobre el calendario', () => {
  it('suma y resta días', () => {
    expect(addFarmDays('2026-07-26', 5)).toBe('2026-07-31');
    expect(addFarmDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('cruza fin de mes y año bisiesto', () => {
    expect(addFarmDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addFarmDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('EL DÍA QUE CAMBIA EL HORARIO DE VERANO NO CORRE LA CUENTA', () => {
    // Sumar 86.400.000 ms sobre una fecha local se equivoca un día donde el día dura 23 o 25 horas.
    // Acá se opera sobre el calendario, donde todos los días miden lo mismo.
    expect(addFarmDays('2026-03-28', 1)).toBe('2026-03-29'); // Europa adelanta
    expect(addFarmDays('2026-10-31', 1)).toBe('2026-11-01'); // atrasa
    expect(addFarmDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('una fecha calendario NO tiene zona horaria', () => {
  it('UNA FECHA YA NORMALIZADA SE DEVUELVE INTACTA', () => {
    // El bug que esto mata: `2026-07-26` es el 26 en cualquier parte. Pasarla por una conversión de
    // zona la lee como medianoche UTC —las 21:00 del 25 en Buenos Aires— y la corre un día. Todo lo
    // que se cuente desde ahí (la próxima recurrencia, el próximo refuerzo) sale un día antes.
    expect(asFarmDate('2026-07-26', 'America/Argentina/Buenos_Aires')).toBe('2026-07-26');
    expect(asFarmDate('2026-07-26', 'Asia/Tokyo')).toBe('2026-07-26');
    expect(asFarmDate('2026-07-26', CARACAS)).toBe('2026-07-26');
  });

  it('un INSTANTE sí se convierte: ése depende de dónde se lo mire', () => {
    expect(asFarmDate('2026-07-26T20:30:00-04:00', CARACAS)).toBe('2026-07-26');
    expect(asFarmDate(new Date('2026-07-27T00:30:00Z'), CARACAS)).toBe('2026-07-26');
  });

  it('sumar sobre una fecha calendario no depende de la zona', () => {
    // La recurrencia de 7 días desde el 26 cae el 2, se mire desde donde se mire.
    for (const tz of [CARACAS, 'Asia/Tokyo', 'UTC'])
      expect(addFarmDays(asFarmDate('2026-07-26', tz), 7)).toBe('2026-08-02');
  });
});
