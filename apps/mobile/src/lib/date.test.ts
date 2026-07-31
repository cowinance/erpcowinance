import { afterEach, describe, expect, it } from 'vitest';
import { addFarmDays, farmToday, getFarmTimeZone, setFarmTimeZone } from './date';

/** 30/7/2026 a las 02:00 UTC = todavía el 29 en Caracas (UTC−4) y ya el 30 en Tokio (UTC+9). */
const MADRUGADA_UTC = new Date('2026-07-30T02:00:00Z');

afterEach(() => setFarmTimeZone(null));

describe('el móvil fecha en la zona de la FINCA, no en la del teléfono', () => {
  // NOTA para quien toque estos tests: cada caso mide DOS zonas cuya respuesta difiere, nunca una
  // sola. Con una sola, el test pasa aunque la implementación ignore la zona y use la de la máquina
  // — que es exactamente el bug — porque el CI puede correr en un huso que da la misma fecha que la
  // esperada. Se comprobó: en la primera versión, tres de estos casos seguían en verde con el
  // arreglo quitado. Un par que difiere solo lo puede satisfacer algo que de verdad mire la zona.

  it('el caso que estaba mal: la fecha la decide la FINCA, no el teléfono', () => {
    // Antes cada dispositivo usaba SU zona, así que el mismo parto quedaba en dos días según quién
    // lo cargara. El par prueba que ahora la respuesta se mueve con la finca y con nada más.
    setFarmTimeZone('America/Caracas');
    expect(farmToday(MADRUGADA_UTC), 'finca en Venezuela').toBe('2026-07-29');
    setFarmTimeZone('Asia/Tokyo');
    expect(farmToday(MADRUGADA_UTC), 'finca en Japón').toBe('2026-07-30');
  });

  it('coincide con lo que fecharía el SERVIDOR para ese mismo instante', () => {
    // El servidor pone `organizations.timezone` en el TimeZone de la conexión y de ahí salen sus
    // fechas. Si el móvil usara otra regla, el mismo evento tendría dos fechas según quién lo mire.
    const comoElServidor = (tz: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        MADRUGADA_UTC,
      );
    for (const tz of ['America/Caracas', 'Asia/Tokyo', 'Pacific/Auckland']) {
      setFarmTimeZone(tz);
      expect(farmToday(MADRUGADA_UTC), tz).toBe(comoElServidor(tz));
    }
  });

  it('el atardecer de la finca sigue siendo el MISMO día', () => {
    // El bug original: en Venezuela todo lo cargado después de las 20:00 se fechaba al día
    // siguiente. Encerrar al atardecer es lo normal, no la excepción.
    const atardecer = new Date('2026-07-26T23:30:00Z'); // 19:30 en Caracas, 08:30 del 27 en Tokio
    setFarmTimeZone('America/Caracas');
    expect(farmToday(atardecer), '19:30 en la finca, mismo día').toBe('2026-07-26');
    setFarmTimeZone('Asia/Tokyo');
    expect(farmToday(atardecer), 'la misma hora en otra finca ya es el día siguiente').toBe('2026-07-27');
  });
});

describe('sin zona conocida', () => {
  it('cae en la del dispositivo y NO revienta', () => {
    // Solo pasa antes del primer bootstrap, cuando todavía no hay nada que fechar. Trabarse acá
    // dejaría la app sin poder arrancar por un dato que todavía no llegó.
    setFarmTimeZone(null);
    expect(farmToday(MADRUGADA_UTC)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('una zona vacía o en blanco cuenta como no saber', () => {
    setFarmTimeZone('   ');
    expect(getFarmTimeZone()).toBeNull();
    setFarmTimeZone(undefined);
    expect(getFarmTimeZone()).toBeNull();
  });

  it('una zona INVENTADA no tumba la app', () => {
    // El valor viene de la base y podría estar mal cargado. Que una fecha reviente a las 20:00 es
    // el peor momento para descubrirlo, así que el dominio cae a UTC en vez de lanzar.
    setFarmTimeZone('Marte/Olympus');
    expect(() => farmToday(MADRUGADA_UTC)).not.toThrow();
    expect(farmToday(MADRUGADA_UTC)).toBe('2026-07-30'); // UTC
  });
});

describe('sumar días es calendario puro', () => {
  it('no se corre aunque haya cambio de horario de verano en el medio', () => {
    // En la zona donde el día dura 23 o 25 horas, sumar milisegundos se corre un día.
    setFarmTimeZone('America/Santiago');
    expect(addFarmDays('2026-09-05', 1)).toBe('2026-09-06');
    expect(addFarmDays('2026-04-04', 1)).toBe('2026-04-05');
  });

  it('cruza fin de mes y fin de año', () => {
    expect(addFarmDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addFarmDays('2026-02-28', 1)).toBe('2026-03-01'); // 2026 no es bisiesto
  });
});
